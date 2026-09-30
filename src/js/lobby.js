// src/js/lobby.js

const btnPlayFriends = document.getElementById('btn-play-friends');
const btnRoomList = document.getElementById('btn-room-list');
const mainLobbyScreen = document.getElementById('main-lobby-screen');
const roomListScreen = document.getElementById('room-list-screen');

// src/js/lobby.js

console.log("🎉 File lobby.js đã tải thành công!");

// 1. CHƠI NHANH
const btnQuickPlay = document.getElementById('btn-quick-play');
if (btnQuickPlay) {
    btnQuickPlay.addEventListener('click', () => {
        alert('Đang tìm phòng phù hợp...');
    });
}

// 2. CHƠI VỚI BẠN (NÚT CÙNG VUI)
const btnToggleFriendMenu = document.getElementById('btn-toggle-friend-menu');
const friendDropdownMenu = document.getElementById('my-friend-dropdown-menu');

if (btnToggleFriendMenu && friendDropdownMenu) {
    btnToggleFriendMenu.addEventListener('click', () => {
        friendDropdownMenu.hidden = !friendDropdownMenu.hidden;
    });
}

// 3. TẠO BÀN & VÀO BÀN (Nằm trong menu Cùng Vui)
const btnCreateRoom = document.getElementById('btn-create-room');
if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
        alert('Đang tiến hành tạo bàn mới...');
    });
}

const btnJoinRoom = document.getElementById('btn-join-room');
const inputRoomCode = document.getElementById('join-room-code');
if (btnJoinRoom && inputRoomCode) {
    btnJoinRoom.addEventListener('click', () => {
        const code = inputRoomCode.value.trim();
        if (code) {
            alert(`Đang tham gia bàn mã: ${code}`);
        } else {
            alert('Vui lòng nhập mã phòng!');
        }
    });
}