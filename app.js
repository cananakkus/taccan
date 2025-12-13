const screens = document.querySelectorAll(".screen");

function showScreen(id) {
    screens.forEach(screen => screen.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
}

document.getElementById("create-room").onclick = () => {
  localStorage.setItem("roomCode", generateRoomCode());
  showScreen("username-screen");
};

document.getElementById("join-room").onclick = () => {
  const code = document.getElementById("room-code-input").value;
  if (!code) return;
  localStorage.setItem("roomCode", code);
  showScreen("username-screen");
};

document.getElementById("confirm-username").onclick = () => {
  const username = document.getElementById("username-input").value;
  if (!username) return;

  localStorage.setItem("username", username);
  document.getElementById("player-name").innerText = username;

  showScreen("game-screen");
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

const words = [
  "Kedi", "Uçak", "Elma", "Deniz", "Bilgisayar",
  "Saat", "Köprü", "Güneş", "Kitap", "Telefon",
  "Masa", "Kalem", "Ay", "Bulut", "Araba",
  "Yıldız", "Dağ", "Kahve", "Müzik", "Ağaç",
  "Kapı", "Film", "Oyun", "Kamera", "Bardak"
];

function createBoard() {
  const board = document.getElementById("game-board");
  board.innerHTML = "";

  words.forEach((word, index) => {
    const card = document.createElement("div");
    card.classList.add("card");
    card.innerText = word;
    card.dataset.index = index;

    card.addEventListener("click", () => {
      revealCard(card);
    });

    board.appendChild(card);
  });
}

function revealCard(card) {
  card.style.background = "#ccc";
  card.style.pointerEvents = "none";
  console.log("Clicked card index:", card.dataset.index);
}

document.getElementById("confirm-username").onclick = () => {
  const username = document.getElementById("username-input").value;
  if (!username) return;

  localStorage.setItem("username", username);
  document.getElementById("player-name").innerText = username;

  showScreen("game-screen");
  createBoard(); // 🔥 BURASI
};
