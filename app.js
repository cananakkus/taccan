console.log("app.js yüklendi");

// ---------------- SCREENS ----------------
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
  screens.forEach(screen => screen.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---------------- GAME STATE ----------------
const gameState = {
  turn: "red",
  revealedCards: [],
  roles: [],
  playerRole: "player",
  remaining: {
    red: 9,
    blue: 8
  },
  clue: {
    word: null,
    remainingGuesses: 0
  },
  isGameOver: false
};

// ---------------- HOME ACTIONS ----------------
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

  showScreen("role-screen");
};

// ---------------- ROLE SELECTION ----------------
document.getElementById("player-role").onclick = () => {
  gameState.playerRole = "player";
  startGame();
  showScreen("game-screen");
};

document.getElementById("spymaster-role").onclick = () => {
  gameState.playerRole = "spymaster";
  startGame();
  showScreen("game-screen");
};

// ---------------- GAME START ----------------
function startGame() {
  gameState.turn = "red";
  gameState.revealedCards = [];
  gameState.roles = generateRoles();
  gameState.remaining = { red: 9, blue: 8 };
  gameState.isGameOver = false;
  gameState.clue.word = null;
  gameState.clue.remainingGuesses = 0;

  document.getElementById("current-clue").innerText = "-";
  document.getElementById("guesses-left").innerText = "-";
  document.getElementById("end-turn").classList.add("hidden");

  if (gameState.playerRole === "spymaster") {
    document.getElementById("spymaster-panel").classList.remove("hidden");
  } else {
    document.getElementById("spymaster-panel").classList.add("hidden");
  }

  updateScoreboard();
  createBoard();
}

// ---------------- SCOREBOARD ----------------
function updateScoreboard() {
  document.getElementById("red-left").innerText = gameState.remaining.red;
  document.getElementById("blue-left").innerText = gameState.remaining.blue;
  document.getElementById("current-turn").innerText =
    gameState.turn.toUpperCase();
}

// ---------------- CLUE LOGIC ----------------
document.getElementById("submit-clue").onclick = () => {
  const word = document.getElementById("clue-word").value.trim();
  const count = Number(document.getElementById("clue-count").value);

  if (!word || !count) return;

  gameState.clue.word = word;
  gameState.clue.remainingGuesses = count + 1; // Codenames kuralı

  document.getElementById("current-clue").innerText = word;
  document.getElementById("guesses-left").innerText =
    gameState.clue.remainingGuesses;

  document.getElementById("spymaster-panel").classList.add("hidden");
  document.getElementById("end-turn").classList.remove("hidden");
};

// ---------------- BOARD ----------------
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
    card.className = "card";
    card.innerText = word;
    card.dataset.index = index;

    if (gameState.playerRole === "spymaster") {
      card.title = gameState.roles[index];
    }

    card.onclick = () => {
      if (gameState.playerRole === "spymaster") return;
      if (gameState.clue.remainingGuesses <= 0) return;
      revealCard(card);
    };

    board.appendChild(card);
  });
}

// ---------------- GAME LOGIC ----------------
function revealCard(card) {
  if (gameState.isGameOver) return;

  const index = Number(card.dataset.index);
  const role = gameState.roles[index];

  if (gameState.revealedCards.includes(index)) return;

  gameState.revealedCards.push(index);
  card.classList.add("revealed");
  card.style.pointerEvents = "none";

  if (role === "assassin") {
    gameState.isGameOver = true;
    alert("💀 Assassin! Oyun bitti.");
    return;
  }

  if (role === "red" || role === "blue") {
    gameState.remaining[role]--;
    updateScoreboard();
  }

  gameState.clue.remainingGuesses--;
  document.getElementById("guesses-left").innerText =
    gameState.clue.remainingGuesses;

  if (role !== gameState.turn || gameState.clue.remainingGuesses === 0) {
    switchTurn();
  }

  checkWin();
}

// ---------------- TURN ----------------
function switchTurn() {
  gameState.turn = gameState.turn === "red" ? "blue" : "red";
  gameState.clue.word = null;
  gameState.clue.remainingGuesses = 0;

  document.getElementById("current-clue").innerText = "-";
  document.getElementById("guesses-left").innerText = "-";
  document.getElementById("end-turn").classList.add("hidden");

  if (gameState.playerRole === "spymaster") {
    document.getElementById("spymaster-panel").classList.remove("hidden");
  }

  updateScoreboard();
}

document.getElementById("end-turn").onclick = () => {
  switchTurn();
};

// ---------------- WIN ----------------
function checkWin() {
  if (gameState.remaining.red === 0) {
    gameState.isGameOver = true;
    alert("🔴 RED KAZANDI!");
  }
  if (gameState.remaining.blue === 0) {
    gameState.isGameOver = true;
    alert("🔵 BLUE KAZANDI!");
  }
}

// ---------------- UTIL ----------------
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generateRoles() {
  const roles = [
    ...Array(9).fill("red"),
    ...Array(8).fill("blue"),
    ...Array(7).fill("neutral"),
    "assassin"
  ];
  return shuffleArray(roles);
}

function shuffleArray(array) {
  return array
    .map(value => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}
