import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../server/db/connection.js';
import { WalletService } from '../../server/services/WalletService.js';
import { AdminService } from '../../server/services/AdminService.js';
import { DatabaseCleanupService } from '../../server/services/DatabaseCleanupService.js';
import { AuditLogger } from '../../server/db/AuditLogger.js';

const ids = [];
const roomIds = [];
const categories = { rooms: true, users: true, audit: true };
const age = "CURRENT_TIMESTAMP - INTERVAL '90 days'";
async function user(role='player', deleted=false) {
  const key=randomUUID().replaceAll('-','');
  const r=await query(`INSERT INTO users(username,email,password_hash,display_name,role,status,deleted_at)
    VALUES($1,$2,'fixture-only-hash','Cleanup fixture',$3,$4,${deleted?age:'NULL'}) RETURNING id`,
    [`cl_${key}`,`cl_${key}@example.com`,role,deleted?'deleted':'active']);
  const id=r.rows[0].id; ids.push(id);
  await WalletService.createWalletWithWelcomeGrant(id,100000);
  await query(`UPDATE wallet_transactions SET created_at=${age} WHERE user_id=$1`,[id]);
  return id;
}
async function room(host, {status='closed',recent=false,pending=false,member=false}={}) {
  const r=await query(`INSERT INTO rooms(code,name,host_id,status,closed_at)
    VALUES($1,'Cleanup room',$2,$3,${recent?'CURRENT_TIMESTAMP':age}) RETURNING id`,[randomUUID().slice(0,8),host,status]);
  const id=r.rows[0].id;roomIds.push(id);
  if(member) await query(`INSERT INTO room_members(room_id,user_id,role,left_at) VALUES($1,$2,'host',${status==='active'?'NULL':age})`,[id,host]);
  if(pending) await query(`INSERT INTO rounds(room_id,round_number,status,started_at) VALUES($1,1,'betting',${age})`,[id]);
  return id;
}
async function exists(table,id) {return (await query(`SELECT 1 FROM ${table} WHERE id=$1`,[id])).rowCount>0;}
async function execute(service,actorId,preview,overrides={}) {
  return service.execute({actorId,previewToken:preview.previewToken,confirmation:'XOA VINH VIEN',requestId:randomUUID(),reason:'Cleanup integration test',...overrides});
}
afterEach(async () => {
  await query('DELETE FROM rooms WHERE id=ANY($1::uuid[])',[roomIds]);
  await query('DELETE FROM admin_request_tombstones WHERE admin_id=ANY($1::uuid[])',[ids]);
  await query('DELETE FROM admin_audit_logs WHERE admin_id=ANY($1::uuid[])',[ids]);
  for(const table of ['processed_commands','wallet_transactions','wallets','auth_sessions','account_tokens','ad_reward_sessions','admin_mfa_credentials']) {
    await query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`,[ids]);
  }
  await query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);
  ids.length=0;roomIds.length=0;
});

test('cleanup preview is read-only, validates retention and rejects a non-admin',async () => {
  const admin=await user('admin');const player=await user();const service=new DatabaseCleanupService();
  const old=await room(player);
  await assert.rejects(service.preview({actorId:player,retentionDays:30,categories}),{code:'ADMIN_REQUIRED'});
  for(const retentionDays of [0,1.5,3651]) await assert.rejects(service.preview({actorId:admin,retentionDays,categories}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(service.preview({actorId:admin,retentionDays:30,categories:{}}),{code:'INVALID_ARGUMENT'});
  const preview=await service.preview({actorId:admin,retentionDays:30,categories});
  assert.ok(preview.counts.rooms>=1);assert.equal(await exists('rooms',old),true);
});

test('cleanup removes old closed-room children while preserving active/recent/pending rooms and active wallets',async () => {
  const admin=await user('admin');const player=await user();const service=new DatabaseCleanupService();
  const old=await room(player,{member:true});
  const active=await room(player,{status:'active'});const recent=await room(player,{recent:true});const pending=await room(player,{pending:true});
  const round=(await query(`INSERT INTO rounds(room_id,round_number,status,started_at,settled_at) VALUES($1,1,'settled',${age},${age}) RETURNING id`,[old])).rows[0].id;
  await query(`INSERT INTO bets(round_id,user_id,symbol,amount,status,request_id,created_at) VALUES($1,$2,'cua',100,'lost',$3,${age})`,[round,player,randomUUID()]);
  await query(`INSERT INTO player_round_results(round_id,user_id,room_id,total_bet,total_return,net_gain,outcome) VALUES($1,$2,$3,100,0,-100,'loss')`,[round,player,old]);
  const preview=await service.preview({actorId:admin,retentionDays:30,categories:{rooms:true}});
  const result=await execute(service,admin,preview);
  assert.equal(result.counts.rounds,1);assert.equal(result.counts.bets,1);
  assert.equal(await exists('rooms',old),false);assert.equal(await exists('rounds',round),false);
  for(const id of [active,recent,pending]) assert.equal(await exists('rooms',id),true);
  assert.equal((await query('SELECT balance FROM wallets WHERE user_id=$1',[player])).rows[0].balance,'100000');
  assert.equal((await query('SELECT 1 FROM wallet_transactions WHERE user_id=$1',[player])).rowCount,1);
});

test('cleanup hard-deletes eligible soft-deleted players, skips linked/recent players, and preserves Admins',async () => {
  const admin=await user('admin');const deletedAdmin=await user('admin',true);const active=await user();
  const eligible=await user('player',true);const linked=await user('player',true);const recent=await user('player',true);
  await room(linked,{status:'active'});await query('UPDATE users SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1',[recent]);
  const service=new DatabaseCleanupService();const preview=await service.preview({actorId:admin,retentionDays:30,categories:{users:true}});
  assert.equal(preview.counts.users,1);assert.ok(preview.skippedUsers>=1);
  await execute(service,admin,preview);
  assert.equal(await exists('users',eligible),false);
  assert.equal((await query('SELECT 1 FROM wallet_transactions WHERE user_id=$1',[eligible])).rowCount,0);
  for(const id of [admin,deletedAdmin,active,linked,recent]) assert.equal(await exists('users',id),true);
});

test('cleanup can delete a soft-deleted host together with its old closed room',async () => {
  const admin=await user('admin');const host=await user('player',true);const old=await room(host,{member:true});
  const service=new DatabaseCleanupService();const preview=await service.preview({actorId:admin,retentionDays:30,categories:{rooms:true,users:true}});
  assert.equal(preview.counts.users,1);await execute(service,admin,preview);
  assert.equal(await exists('users',host),false);assert.equal(await exists('rooms',old),false);
});

test('cleanup rejects forged, cross-account, expired or changed previews and missing confirmation',async () => {
  let now=Date.now();const service=new DatabaseCleanupService({now:()=>now});const admin=await user('admin');const other=await user('admin');const player=await user();
  const old=await room(player);const preview=await service.preview({actorId:admin,retentionDays:30,categories:{rooms:true}});
  await assert.rejects(execute(service,admin,preview,{confirmation:'yes'}),{code:'CONFIRMATION_REQUIRED'});
  await assert.rejects(execute(service,admin,{previewToken:preview.previewToken+'x'}),{code:'PREVIEW_INVALID'});
  await assert.rejects(execute(service,admin,{previewToken:preview.previewToken.split('.')[0]+'.'+'漢'.repeat(43)}),{code:'PREVIEW_INVALID'});
  await assert.rejects(execute(service,other,preview),{code:'PREVIEW_INVALID'});
  now+=600001;await assert.rejects(execute(service,admin,preview),{code:'PREVIEW_EXPIRED'});now-=600001;
  await query("UPDATE rooms SET status='active' WHERE id=$1",[old]);
  await assert.rejects(execute(service,admin,preview),{code:'PREVIEW_CHANGED'});
  assert.equal(await exists('rooms',old),true);
});

test('cleanup protects runtime rooms and replays the same successful request without deleting new candidates',async () => {
  const service=new DatabaseCleanupService();const admin=await user('admin');const player=await user();
  const protectedRoom=await room(player);const old=await room(player);
  const preview=await service.preview({actorId:admin,retentionDays:30,categories:{rooms:true},excludedRoomIds:[protectedRoom]});
  const requestId=randomUUID();const request={requestId,excludedRoomIds:[protectedRoom]};
  await execute(service,admin,preview,request);const newCandidate=await room(player);
  const replay=await execute(service,admin,preview,request);assert.equal(replay.isDuplicate,true);
  assert.equal(await exists('rooms',old),false);assert.equal(await exists('rooms',protectedRoom),true);assert.equal(await exists('rooms',newCandidate),true);
  await assert.rejects(execute(service,admin,preview,{...request,reason:'Different request input'}),{code:'REQUEST_ID_CONFLICT'});
});

test('purging old audits preserves replay protection for old Admin operations and retains cleanup audits',async () => {
  const service=new DatabaseCleanupService();const admin=await user('admin');const player=await user();const adminService=new AdminService();
  const grant={actorId:admin,userId:player,amount:123,reason:'Old grant fixture',requestId:randomUUID()};
  await adminService.grantCoins(grant);
  await query(`UPDATE admin_audit_logs SET created_at=${age} WHERE admin_id=$1`,[admin]);
  const preview=await service.preview({actorId:admin,retentionDays:30,categories:{audit:true}});await execute(service,admin,preview);
  assert.equal((await query('SELECT 1 FROM admin_audit_logs WHERE admin_id=$1 AND request_id=$2',[admin,grant.requestId])).rowCount,0);
  await assert.rejects(adminService.grantCoins(grant),{code:'REQUEST_ID_EXPIRED'});
  assert.equal((await query('SELECT balance FROM wallets WHERE user_id=$1',[player])).rows[0].balance,'100123');
  await query(`UPDATE admin_audit_logs SET created_at=${age} WHERE admin_id=$1`,[admin]);
  const next=await service.preview({actorId:admin,retentionDays:30,categories:{audit:true}});
  assert.equal(next.counts.audit,0);
});

test('audit failure rolls back room deletion and request tombstones',async () => {
  const service=new DatabaseCleanupService();const admin=await user('admin');const player=await user();const old=await room(player);
  const log=await AuditLogger.logAdminAction({adminId:admin,action:'OLD_FIXTURE',requestId:randomUUID()});
  await query(`UPDATE admin_audit_logs SET created_at=${age} WHERE id=$1`,[log.id]);
  const preview=await service.preview({actorId:admin,retentionDays:30,categories});
  const original=AuditLogger.logAdminAction;
  try {
    AuditLogger.logAdminAction=async()=>{throw new Error('Simulated audit failure');};
    await assert.rejects(execute(service,admin,preview),/Simulated audit failure/);
  } finally {AuditLogger.logAdminAction=original;}
  assert.equal(await exists('rooms',old),true);assert.equal(await exists('admin_audit_logs',log.id),true);
  assert.equal((await query('SELECT 1 FROM admin_request_tombstones WHERE admin_id=$1',[admin])).rowCount,0);
});
