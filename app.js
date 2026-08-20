const API_URL = "https://script.google.com/macros/s/AKfycbz2skJ1ynwAJ08M4GzIeOtaO38bj0L_iK6birPOG5NaihBB5pHgMhDRGRbH8A4_u9i4_g/exec";
const LOGIN_STORAGE_KEY = "sparkcards:lastLogin";

const state = {
  starCardId: "",
  grade: "5",
  subject: "Math",
  dashboard: null,
  cardsMeta: [],
  activeCardId: null,
  practiceMode: "dashboard",
  practicePool: [],
  language: "en"
};

const els = {
  lookupForm: document.getElementById("lookupForm"),
  lasidInput: document.getElementById("lasidInput"),
  gradeSelect: document.getElementById("gradeSelect"),
  subjectSelect: document.getElementById("subjectSelect"),
  lookupMessage: document.getElementById("lookupMessage"),
  loginPanel: document.getElementById("loginPanel"),
  dashboardPanel: document.getElementById("dashboardPanel"),
  dashboardContext: document.getElementById("dashboardContext"),
  percentMastered: document.getElementById("percentMastered"),
  totalMastered: document.getElementById("totalMastered"),
  chipGrid: document.getElementById("chipGrid"),
  backButton: document.getElementById("backButton"),
  studyAllButton: document.getElementById("studyAllButton"),
  studyNeedsPracticeButton: document.getElementById("studyNeedsPracticeButton"),
  unitSelect: document.getElementById("unitSelect"),
  practicePanel: document.getElementById("practicePanel"),
  closePracticeButton: document.getElementById("closePracticeButton"),
  practiceTitle: document.getElementById("practiceTitle"),
  practiceModeLabel: document.getElementById("practiceModeLabel"),
  englishButton: document.getElementById("englishButton"),
  spanishButton: document.getElementById("spanishButton"),
  cardMissingMessage: document.getElementById("cardMissingMessage"),
  questionImage: document.getElementById("questionImage"),
  answerImage: document.getElementById("answerImage"),
  studentAnswer: document.getElementById("studentAnswer"),
  showAnswerButton: document.getElementById("showAnswerButton"),
  nextProblemButton: document.getElementById("nextProblemButton"),
  practiceCountText: document.getElementById("practiceCountText")
};

els.lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  state.starCardId = els.lasidInput.value.trim();
  state.grade = els.gradeSelect.value;
  state.subject = els.subjectSelect.value;

  saveLastLoginSelection();
  await loadDashboard();
});

els.backButton.addEventListener("click", () => {
  els.dashboardPanel.classList.add("hidden");
  els.practicePanel.classList.add("hidden");
  els.loginPanel.classList.remove("hidden");
});

els.closePracticeButton.addEventListener("click", () => {
  els.practicePanel.classList.add("hidden");
  els.dashboardPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.studyAllButton.addEventListener("click", () => {
  const ids = Object.keys(state.dashboard?.cards || {});
  startPracticeSet(ids, "all");
});

els.studyNeedsPracticeButton.addEventListener("click", () => {
  const ids = Object.entries(state.dashboard?.cards || {})
    .filter(([, score]) => score === 0 || score === 0.5)
    .map(([cardId]) => cardId);

  if (ids.length === 0) {
    setMessage(els.lookupMessage, "You do not have any partial or incorrect cards right now.", "success");
    return;
  }

  startPracticeSet(ids, "needsPractice");
});

els.unitSelect.addEventListener("change", () => {
  const selectedUnit = els.unitSelect.value;
  if (!selectedUnit) return;

  const ids = getDashboardCardIds()
    .filter(cardId => getUnitForCardId(cardId) === selectedUnit);

  startPracticeSet(ids, "unit");
});

els.englishButton.addEventListener("click", () => {
  state.language = "en";
  els.englishButton.classList.add("active");
  els.spanishButton.classList.remove("active");
  renderPracticeCard();
});

els.spanishButton.addEventListener("click", () => {
  state.language = "es";
  els.spanishButton.classList.add("active");
  els.englishButton.classList.remove("active");
  renderPracticeCard();
});

els.questionImage.addEventListener("click", () => readCurrentCardAloud("question"));
els.answerImage.addEventListener("click", () => readCurrentCardAloud("answer"));

els.showAnswerButton.addEventListener("click", () => {
  const cardId = state.activeCardId;
  if (!cardId) return;

  const answerIsShowing = !els.answerImage.classList.contains("hidden");

  if (answerIsShowing) {
    resetCurrentCardForRetry();
    return;
  }

  const answerPath = getCurrentAnswerPath();

  incrementPracticeCount(cardId);

  if (!answerPath) {
    els.answerImage.classList.add("hidden");
    els.answerImage.removeAttribute("src");
    els.cardMissingMessage.textContent = "Answer coming soon.";
  } else {
    els.answerImage.src = answerPath;
    els.answerImage.classList.remove("hidden");
  }

  els.showAnswerButton.textContent = "Try Again";
  els.nextProblemButton.classList.remove("hidden");
  updatePracticeCountText(cardId);
});

els.nextProblemButton.addEventListener("click", () => {
  openNextPracticeCard();
});

loadLastLoginSelection();

async function loadDashboard() {
  setMessage(els.lookupMessage, "Loading dashboard...", "");

  try {
    const [dashboardData, cardsMeta] = await Promise.all([
      fetchDashboardData(),
      fetchCardsMeta()
    ]);

    if (!dashboardData.found) {
      throw new Error(dashboardData.error || "Could not find that student.");
    }

    state.dashboard = dashboardData;
    state.cardsMeta = cardsMeta;

    renderDashboard();

    els.loginPanel.classList.add("hidden");
    els.dashboardPanel.classList.remove("hidden");
    els.practicePanel.classList.add("hidden");
    setMessage(els.lookupMessage, "", "");
  } catch (error) {
    setMessage(els.lookupMessage, error.message, "error");
  }
}

async function fetchDashboardData() {
  const params = new URLSearchParams({
    starCardId: state.starCardId,
    grade: state.grade,
    subject: state.subject
  });

  const response = await fetch(`${API_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error("The dashboard could not connect to the spreadsheet.");
  }

  return response.json();
}

async function fetchCardsMeta() {
  const path = getCardsJsonPath(state.grade, state.subject);

  try {
    const response = await fetch(path);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function renderDashboard() {
  const gradeLabel = `${state.grade}th Grade`;
  els.dashboardContext.textContent = `${gradeLabel} · ${state.subject}`;
  els.percentMastered.textContent = formatPercent(state.dashboard.percentMastered, state.dashboard.cards);
  els.totalMastered.textContent = state.dashboard.totalCardsMastered === "" ? "--" : state.dashboard.totalCardsMastered;

  renderUnitSelect();
  renderChips(Object.keys(state.dashboard.cards || {}));
}

function renderChips(cardIds) {
  els.chipGrid.innerHTML = "";

  cardIds.forEach(cardId => {
    const normalizedId = normalizeCardId(cardId);
    const score = state.dashboard.cards[normalizedId];
    const status = scoreToStatus(score);

    const button = document.createElement("button");
    button.className = `card-chip ${status}`;
    button.textContent = normalizedId;
    button.type = "button";
    button.title = statusLabel(status);
    button.addEventListener("click", () => openPracticeCard(normalizedId));

    els.chipGrid.appendChild(button);
  });
}

function renderUnitSelect() {
  // Build units from the spreadsheet/dashboard card IDs, not just cards.json.
  // This makes every unit available even before all card images are uploaded.
  const units = [...new Set(
    getDashboardCardIds()
      .map(getUnitForCardId)
      .filter(Boolean)
  )].sort(sortUnitLabels);

  els.unitSelect.innerHTML = `<option value="">Choose a unit</option>`;

  units.forEach(unit => {
    const option = document.createElement("option");
    option.value = unit;
    option.textContent = unit;
    els.unitSelect.appendChild(option);
  });
}

function startPracticeSet(cardIds, mode) {
  const normalizedIds = [...new Set((cardIds || []).map(normalizeCardId).filter(Boolean))];

  if (!normalizedIds.length) return;

  state.practiceMode = mode;
  state.practicePool = normalizedIds;
  openPracticeCard(getRandomCardId(normalizedIds), mode, normalizedIds);
}

function openPracticeCard(cardId, mode = "dashboard", practicePool = null) {
  state.activeCardId = normalizeCardId(cardId);
  state.practiceMode = mode;
  state.practicePool = Array.isArray(practicePool) ? practicePool : getDashboardCardIds();

  // Keep the student's current language choice when moving between cards.
  // Previously this reset to English every time a new card opened.
  syncLanguageButtons();

  els.practicePanel.classList.remove("hidden");
  resetPracticeButtons();
  els.studentAnswer.value = "";
  renderPracticeCard();
  els.practicePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncLanguageButtons() {
  if (state.language === "es") {
    els.spanishButton.classList.add("active");
    els.englishButton.classList.remove("active");
  } else {
    els.englishButton.classList.add("active");
    els.spanishButton.classList.remove("active");
  }
}

function openNextPracticeCard() {
  if (!state.activeCardId) return;

  let nextCardId = "";

  if (state.practiceMode === "dashboard") {
    nextCardId = getNextDashboardCardId(state.activeCardId);
  } else {
    nextCardId = getRandomCardId(state.practicePool, state.activeCardId);
  }

  if (!nextCardId) return;

  const currentMode = state.practiceMode;
  const currentPool = [...state.practicePool];
  openPracticeCard(nextCardId, currentMode, currentPool);
}

function resetCurrentCardForRetry() {
  els.answerImage.classList.add("hidden");
  els.answerImage.removeAttribute("src");
  els.studentAnswer.value = "";
  resetPracticeButtons();
  renderPracticeCard();
  els.studentAnswer.focus();
}

function resetPracticeButtons() {
  els.showAnswerButton.textContent = "Show Answer";
  els.nextProblemButton.classList.add("hidden");
}

function getDashboardCardIds() {
  return Object.keys(state.dashboard?.cards || {}).map(normalizeCardId);
}

function getUnitForCardId(cardId) {
  const normalizedId = normalizeCardId(cardId);
  const cardMeta = state.cardsMeta.find(card => normalizeCardId(card.id) === normalizedId);

  if (cardMeta && cardMeta.unit) {
    return normalizeUnitLabel(cardMeta.unit);
  }

  const match = normalizedId.match(/^(\d+)/);
  return match ? `Unit ${Number(match[1])}` : "Other";
}

function normalizeUnitLabel(unit) {
  const text = String(unit || "").trim();
  const match = text.match(/unit\s*(\d+)/i);
  return match ? `Unit ${Number(match[1])}` : text;
}

function sortUnitLabels(a, b) {
  const aMatch = String(a).match(/unit\s*(\d+)/i);
  const bMatch = String(b).match(/unit\s*(\d+)/i);

  if (aMatch && bMatch) {
    return Number(aMatch[1]) - Number(bMatch[1]);
  }

  return String(a).localeCompare(String(b));
}

function getNextDashboardCardId(currentCardId) {
  const ids = getDashboardCardIds();
  if (!ids.length) return "";

  const currentIndex = ids.indexOf(normalizeCardId(currentCardId));
  if (currentIndex === -1) return ids[0];

  return ids[(currentIndex + 1) % ids.length];
}

function getRandomCardId(cardIds, excludeCardId = "") {
  const ids = [...new Set((cardIds || []).map(normalizeCardId).filter(Boolean))];
  if (!ids.length) return "";

  const excluded = normalizeCardId(excludeCardId);
  const choices = ids.length > 1 ? ids.filter(id => id !== excluded) : ids;
  return choices[Math.floor(Math.random() * choices.length)];
}

function renderPracticeCard() {
  const card = getActiveCardMeta();
  const cardId = state.activeCardId;

  els.practiceTitle.textContent = `Card ${cardId}`;
  els.practiceModeLabel.textContent = getPracticeModeLabel();

  // Important: clear old images every time a new card opens.
  // This prevents a missing card from accidentally showing the previous card's answer.
  els.questionImage.classList.add("hidden");
  els.answerImage.classList.add("hidden");
  els.questionImage.removeAttribute("src");
  els.answerImage.removeAttribute("src");
  els.cardMissingMessage.textContent = "";
  els.cardMissingMessage.className = "message";

  if (!card) {
    els.cardMissingMessage.textContent = "This study card is coming soon.";
    updatePracticeCountText(cardId);
    return;
  }

  const questionPath = getImagePath(card, "question");
  const answerPath = getImagePath(card, "answer");

  if (state.language === "es" && (!card.questionImageEs || !card.answerImageEs)) {
    els.cardMissingMessage.textContent = "Spanish version coming soon. Showing English for now.";
  }

  if (questionPath) {
    els.questionImage.src = questionPath;
    els.questionImage.classList.remove("hidden");
  } else {
    els.cardMissingMessage.textContent = "This study card is coming soon.";
  }

  // Do not show the answer yet. We only store the path now.
  // If there is no answer image, the Show Answer button will say "Answer coming soon."
  if (answerPath) {
    els.answerImage.dataset.answerPath = answerPath;
  } else {
    delete els.answerImage.dataset.answerPath;
  }

  updatePracticeCountText(cardId);
}
function getCurrentAnswerPath() {
  const card = getActiveCardMeta();
  if (!card) return "";
  return getImagePath(card, "answer");
}

function getPracticeModeLabel() {
  if (state.practiceMode === "all") return "Study All";
  if (state.practiceMode === "needsPractice") return "Study Partial / Incorrect";
  if (state.practiceMode === "unit") {
    return els.unitSelect.value ? `Study ${els.unitSelect.value}` : "Study by Unit";
  }
  return "Practice Mode";
}

function getImagePath(card, side) {
  const baseFolder = getSubjectFolder(state.grade, state.subject);
  const languageSuffix = state.language === "es" ? "Es" : "En";
  const fallbackSuffix = "En";
  const fieldName = side === "question" ? `questionImage${languageSuffix}` : `answerImage${languageSuffix}`;
  const fallbackFieldName = side === "question" ? `questionImage${fallbackSuffix}` : `answerImage${fallbackSuffix}`;
  const imagePath = card[fieldName] || card[fallbackFieldName];

  return imagePath ? `${baseFolder}/${imagePath}` : "";
}

function readCurrentCardAloud(side = "question") {
  const card = getActiveCardMeta();
  if (!card || !window.speechSynthesis) return;

  const text = getReadAloudText(card, side);

  if (!text) {
    els.cardMissingMessage.textContent = side === "answer"
      ? "Answer read-aloud coming soon for this card."
      : "Question read-aloud coming soon for this card.";
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.language === "es" ? "es-US" : "en-US";
  window.speechSynthesis.speak(utterance);
}

function getReadAloudText(card, side) {
  const isSpanish = state.language === "es";

  if (side === "answer") {
    return isSpanish
      ? (card.answerReadAloudEs || card.answerReadAloudEn || "")
      : (card.answerReadAloudEn || "");
  }

  return isSpanish
    ? (card.questionReadAloudEs || card.readAloudEs || card.questionReadAloudEn || card.readAloudEn || "")
    : (card.questionReadAloudEn || card.readAloudEn || "");
}

function getActiveCardMeta() {
  return state.cardsMeta.find(card => normalizeCardId(card.id) === state.activeCardId);
}

function getCardsJsonPath(grade, subject) {
  // Cache-bust cards.json so new Spanish image fields appear quickly after GitHub updates.
  return `${getSubjectFolder(grade, subject)}/cards.json?v=${Date.now()}`;
}

function getSubjectFolder(grade, subject) {
  return `cards/grade${grade}/${subject.toLowerCase()}`;
}

function normalizeCardId(value) {
  return String(value || "")
    .trim()
    .replace(/\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function scoreToStatus(score) {
  if (score === 1) return "mastered";
  if (score === 0.5) return "partial";
  if (score === 0) return "incorrect";
  return "not-tested";
}

function statusLabel(status) {
  if (status === "mastered") return "Mastered";
  if (status === "partial") return "Partial";
  if (status === "incorrect") return "Practice this";
  return "Not tested yet";
}

function formatPercent(percent, cards) {
  if (percent !== "" && percent !== null && percent !== undefined) {
    return `${percent}%`;
  }

  const values = Object.values(cards || {}).filter(value => value !== "");
  if (!values.length) return "--%";

  const mastered = values.filter(value => value === 1).length;
  return `${Math.round((mastered / values.length) * 100)}%`;
}

function getPracticeStorageKey(cardId) {
  return `starPractice:${state.starCardId}:${state.grade}:${state.subject}:${cardId}`;
}

function getPracticeCount(cardId) {
  return Number(localStorage.getItem(getPracticeStorageKey(cardId)) || 0);
}

function incrementPracticeCount(cardId) {
  const nextCount = getPracticeCount(cardId) + 1;
  localStorage.setItem(getPracticeStorageKey(cardId), String(nextCount));
}

function updatePracticeCountText(cardId) {
  const count = getPracticeCount(cardId);
  els.practiceCountText.textContent = `Practiced: ${count} time${count === 1 ? "" : "s"} on this device`;
}

function saveLastLoginSelection() {
  const data = {
    starCardId: state.starCardId,
    grade: state.grade,
    subject: state.subject
  };

  localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(data));
}

function loadLastLoginSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOGIN_STORAGE_KEY) || "null");
    if (!saved) return;

    const savedId = saved.starCardId || saved.lasid;
    if (savedId) {
      els.lasidInput.value = savedId;
      state.starCardId = savedId;
    }

    if (saved.grade) {
      els.gradeSelect.value = saved.grade;
      state.grade = saved.grade;
    }

    if (saved.subject) {
      els.subjectSelect.value = saved.subject;
      state.subject = saved.subject;
    }
  } catch (error) {
    localStorage.removeItem(LOGIN_STORAGE_KEY);
  }
}

function setMessage(element, text, type) {
  element.textContent = text;
  element.className = `message ${type || ""}`.trim();
}
