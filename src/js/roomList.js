// src/js/roomList.js

const btnBackToLobby = document.getElementById('btn-back-to-lobby');
const mainLobbyScreen = document.getElementById('main-lobby-screen');
const roomListScreen = document.getElementById('room-list-screen');
const roomCardsContainer = document.getElementById('room-cards-container');

// Quay lại sảnh chính
btnBackToLobby.addEventListener('click', () => {
    roomListScreen.hidden = true;
    mainLobbyScreen.hidden = false;
});

// Nút Tạo Bàn trong danh sách
document.getElementById('btn-create-room-list').addEventListener('click', () => {
    alert('Bắt đầu tạo bàn riêng...');
});

// Hàm mẫu Render thẻ phòng
export function renderRooms(roomDataList) {
    roomCardsContainer.innerHTML = '';

    if (roomDataList.length === 0) {
        roomCardsContainer.innerHTML = '<p style="color:white;">Hiện chưa có bàn nào. Hãy tạo bàn mới!</p>';
        return;
    }

    roomDataList.forEach(room => {
        const card = document.createElement('div');
        card.className = 'room-card';
        card.style.cssText = `
            background: linear-gradient(145deg, #1a3c5a, #0d1f30);
            border: 1px solid #ffd700;
            border-radius: 8px;
            padding: 10px;
            text-align: center;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;

        card.innerHTML = `
            <div style="color: #ffd700; font-weight: bold; margin-bottom: 5px;">${room.hostName || 'Phòng'}</div>
            <div style="font-size: 0.9rem; color: #fff;">Mức cược: 🪙 ${room.minBet}</div>
            <div style="font-size: 0.8rem; color: #aaa; margin-top: 5px;">👥 ${room.playerCount}/20</div>
        `;

        card.addEventListener('click', () => {
            alert(`Đang tham gia bàn của ${room.hostName}...`);
        });

        roomCardsContainer.appendChild(card);
    });
}