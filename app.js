const API_URL = "https://script.google.com/macros/s/AKfycbz2skJ1ynwAJ08M4GzIeOtaO38bj0L_iK6birPOG5NaihBB5pHgMhDRGRbH8A4_u9i4_g/exec";
const LOGIN_STORAGE_KEY = "sparkcards:lastLogin";
const GUEST_STAR_CARD_ID = "0";

const state = {
  starCardId: "",
  grade: "5",
  subject: "Math",
  dashboard: null,
  cardsMeta: [],
  hiddenCardIds: [],
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
  checkAnswerButton: document.getElementById("checkAnswerButton"),
  answerFeedbackMessage: document.getElementById("answerFeedbackMessage"),
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
  const ids = getDisplayCardIds();
  startPracticeSet(ids, "all");
});

els.studyNeedsPracticeButton.addEventListener("click", () => {
  if (isGuestMode()) {
    setMessage(els.lookupMessage, "Type your own STAR Card ID to see partial or incorrect cards.", "success");
    return;
  }

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

  const ids = getDisplayCardIds()
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

els.checkAnswerButton.addEventListener("click", checkStudentAnswer);

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
    const [cardsMeta, hiddenCardIds] = await Promise.all([
      fetchCardsMeta(),
      fetchHiddenCardIds(state.grade, state.subject)
    ]);

    let dashboardData;

    if (isGuestMode()) {
      dashboardData = buildGuestDashboard(cardsMeta, hiddenCardIds);
    } else {
      dashboardData = await fetchDashboardData();
    }

    if (!dashboardData.found) {
      throw new Error(dashboardData.error || "Could not find that student.");
    }

    state.dashboard = dashboardData;
    state.cardsMeta = cardsMeta;
    state.hiddenCardIds = hiddenCardIds;

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

function isGuestMode() {
  return normalizeStudentId(state.starCardId) === GUEST_STAR_CARD_ID;
}

function normalizeStudentId(value) {
  return String(value || "").trim();
}

function buildGuestDashboard(cardsMeta, hiddenCardIds) {
  const hiddenSet = new Set((hiddenCardIds || []).map(normalizeCardId));
  const cards = {};

  (cardsMeta || []).forEach(card => {
    const cardId = normalizeCardId(card.id);
    if (cardId && !hiddenSet.has(cardId)) cards[cardId] = "";
  });

  return {
    found: true,
    guestMode: true,
    grade: state.grade,
    subject: state.subject,
    percentMastered: "",
    totalCardsMastered: "",
    cards
  };
}

async function fetchHiddenCardIds(grade, subject) {
  const url = `${API_URL}?action=cardVisibility&grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return data.found ? (data.hiddenCardIds || []) : [];
  } catch (error) {
    return [];
  }
}

function renderDashboard() {
  const gradeLabel = `${state.grade}th Grade`;
  els.dashboardContext.textContent = isGuestMode()
    ? `${gradeLabel} · ${state.subject} · All Cards`
    : `${gradeLabel} · ${state.subject}`;

  els.percentMastered.textContent = isGuestMode()
    ? "--"
    : formatPercent(state.dashboard.percentMastered, state.dashboard.cards);

  els.totalMastered.textContent = isGuestMode()
    ? "--"
    : (state.dashboard.totalCardsMastered === "" ? "--" : state.dashboard.totalCardsMastered);

  renderUnitSelect();
  renderChips(getDisplayCardIds());
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
  // Build units from the website card order when cards.json exists.
  // Fall back to dashboard cards only if cards.json is missing.
  const units = [...new Set(
    getDisplayCardIds()
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
  state.practicePool = Array.isArray(practicePool) ? practicePool : getDisplayCardIds();

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

function getWebsiteCardIds() {
  const hiddenSet = new Set((state.hiddenCardIds || []).map(normalizeCardId));

  return (state.cardsMeta || [])
    .map(card => normalizeCardId(card.id))
    .filter(Boolean)
    .filter(cardId => !hiddenSet.has(cardId));
}

function getDisplayCardIds() {
  const websiteIds = getWebsiteCardIds();
  return websiteIds.length ? websiteIds : getDashboardCardIds();
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
  const ids = getDisplayCardIds();
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
  setMessage(els.answerFeedbackMessage, "", "");

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

function checkStudentAnswer() {
  const cardId = state.activeCardId;
  if (!cardId) return;

  const studentAnswer = els.studentAnswer.value.trim();

  if (!studentAnswer) {
    setMessage(els.answerFeedbackMessage, "Type your answer first, then check it.", "error");
    return;
  }

  const card = getActiveCardMeta();
  const acceptedAnswerGroups = card ? getAcceptedAnswerGroups(card) : [];

  if (!acceptedAnswerGroups.length) {
    setMessage(els.answerFeedbackMessage, "Answer feedback isn't available for this card yet.", "");
    return;
  }

  const { result, matchedCount, totalCount } = gradeAnswerLocally(studentAnswer, acceptedAnswerGroups);
  renderAnswerFeedback(result, matchedCount, totalCount);
}

function renderAnswerFeedback(result, matchedCount, totalCount) {
  const icon = result === "correct" ? "✅" : result === "partial" ? "🟡" : "❌";
  const label = result === "correct" ? "Correct!" : result === "partial" ? "Partially correct." : "Not quite — try again.";
  const detail = totalCount > 1 ? ` (${matchedCount}/${totalCount} parts)` : "";

  setMessage(els.answerFeedbackMessage, `${icon} ${label}${detail}`, result);
}

/***** LOCAL ANSWER MATCHING (no network / AI call) *****/
//
// Each card's acceptedAnswers field (populated ahead of time, not at grading
// time) is a list of "concept groups": acceptedAnswers[i] is an array of
// alternate phrasings that all mean the same one idea. A student's typed
// answer is graded by how many of those concepts it covers — matching every
// synonym in a group is not required, just one phrasing per group.

const MATCH_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "of", "to", "in", "on",
  "for", "and", "or", "it", "this", "that", "be", "by", "with", "as", "at",
  "you", "your", "we", "can", "will", "there"
]);

function getAcceptedAnswerGroups(card) {
  const groups = state.language === "es" && Array.isArray(card.acceptedAnswersEs) && card.acceptedAnswersEs.length
    ? card.acceptedAnswersEs
    : card.acceptedAnswers;

  return Array.isArray(groups) ? groups.filter(group => Array.isArray(group) && group.length) : [];
}

function gradeAnswerLocally(studentAnswer, acceptedAnswerGroups) {
  const studentTokens = tokenizeForMatching(studentAnswer);
  const totalCount = acceptedAnswerGroups.length;

  const matchedCount = acceptedAnswerGroups.filter(synonyms =>
    synonyms.some(phrase => phraseMatches(studentTokens, tokenizeForMatching(phrase)))
  ).length;

  const ratio = totalCount ? matchedCount / totalCount : 0;
  const result = ratio >= 1 ? "correct" : ratio > 0 ? "partial" : "incorrect";

  return { result, matchedCount, totalCount };
}

function normalizeForMatching(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/(\d)\.(\d)/g, "$1<DECIMAL>$2") // protect real decimal points, e.g. "8.56"
    .replace(/[^a-z0-9\sáéíóúñü^/=+*-]/g, " ") // any other period is sentence punctuation, not part of a number
    .replace(/<DECIMAL>/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForMatching(text) {
  return normalizeForMatching(text).split(" ").filter(Boolean);
}

function isNumericToken(token) {
  return /^[0-9]+(\.[0-9]+)?$/.test(token);
}

function tokensMatch(a, b) {
  if (a === b) return true;
  if (isNumericToken(a) || isNumericToken(b)) return false; // numbers must match exactly
  if (a.length < 4 || b.length < 4) return false; // avoid false positives on short words
  const maxDistance = a.length <= 6 ? 1 : 2;
  return levenshteinDistance(a, b) <= maxDistance;
}

function phraseMatches(studentTokens, phraseTokens) {
  const significantWords = phraseTokens.filter(token => !MATCH_STOPWORDS.has(token));
  if (!significantWords.length) return false;

  const matchedWords = significantWords.filter(word =>
    studentTokens.some(studentToken => tokensMatch(word, studentToken))
  );

  const requiredMatches = significantWords.length <= 2
    ? significantWords.length
    : Math.ceil(significantWords.length * 0.8);

  return matchedWords.length >= requiredMatches;
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }

  return dp[a.length][b.length];
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

/***** CLASS LEADERBOARD *****/

const leaderboardEls = {
  openButton: document.getElementById("openLeaderboardButton"),
  panel: document.getElementById("leaderboardPanel"),
  closeButton: document.getElementById("closeLeaderboardButton"),
  viewHomeroomButton: document.getElementById("leaderboardViewHomeroomButton"),
  viewGradeButton: document.getElementById("leaderboardViewGradeButton"),
  gradeFilterWrapper: document.getElementById("leaderboardGradeFilterWrapper"),
  gradeFilter: document.getElementById("leaderboardGradeFilter"),
  subjectFilter: document.getElementById("leaderboardSubjectFilter"),
  list: document.getElementById("leaderboardList"),
  message: document.getElementById("leaderboardMessage"),
  updatedText: document.getElementById("leaderboardUpdatedText")
};

const leaderboardState = {
  view: "homeroom", // "homeroom" or "grade"
  lastData: null
};

function initLeaderboard() {
  if (!leaderboardEls.openButton) return; // leaderboard markup isn't on this page

  leaderboardEls.openButton.addEventListener("click", openLeaderboard);
  leaderboardEls.closeButton.addEventListener("click", closeLeaderboard);
  leaderboardEls.viewHomeroomButton.addEventListener("click", () => setLeaderboardView("homeroom"));
  leaderboardEls.viewGradeButton.addEventListener("click", () => setLeaderboardView("grade"));
  leaderboardEls.gradeFilter.addEventListener("change", loadLeaderboard);
  leaderboardEls.subjectFilter.addEventListener("change", loadLeaderboard);
}

function setLeaderboardView(view) {
  leaderboardState.view = view;

  leaderboardEls.viewHomeroomButton.classList.toggle("active", view === "homeroom");
  leaderboardEls.viewGradeButton.classList.toggle("active", view === "grade");
  leaderboardEls.gradeFilterWrapper.classList.toggle("hidden", view === "grade");

  if (leaderboardState.lastData) {
    renderLeaderboard(leaderboardState.lastData);
  } else {
    loadLeaderboard();
  }
}

function openLeaderboard() {
  document.getElementById("loginPanel")?.classList.add("hidden");
  document.getElementById("dashboardPanel")?.classList.add("hidden");
  document.getElementById("practicePanel")?.classList.add("hidden");
  leaderboardEls.panel.classList.remove("hidden");
  loadLeaderboard();
}

function closeLeaderboard() {
  leaderboardEls.panel.classList.add("hidden");
  document.getElementById("loginPanel")?.classList.remove("hidden");
}

async function loadLeaderboard() {
  const grade = leaderboardEls.gradeFilter.value;
  const subject = leaderboardEls.subjectFilter.value;

  leaderboardEls.message.textContent = "Loading leaderboard...";
  leaderboardEls.list.innerHTML = "";

  try {
    const url = `${API_URL}?action=leaderboard&grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.found) {
      leaderboardEls.message.textContent = data.error || "Could not load the leaderboard.";
      return;
    }

    leaderboardState.lastData = data;
    renderLeaderboard(data);
  } catch (error) {
    leaderboardEls.message.textContent = "Could not load the leaderboard. Please try again.";
  }
}

function renderLeaderboard(data) {
  const updated = new Date(data.generatedAt);
  leaderboardEls.updatedText.textContent =
    `Updated ${updated.toLocaleDateString()} at ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  if (leaderboardState.view === "grade") {
    renderGradeComparison(data.grades || []);
  } else {
    renderHomeroomLeaderboard(data.homerooms || []);
  }
}

function renderHomeroomLeaderboard(homerooms) {
  leaderboardEls.message.textContent = homerooms.length ? "" : "No homeroom data yet.";

  leaderboardEls.list.innerHTML = homerooms.map((entry, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;

    return `
      <li class="leaderboard-row rank-${rank <= 3 ? rank : "other"}">
        <span class="leaderboard-rank">${medal}</span>
        <span class="leaderboard-name">
          <span class="leaderboard-homeroom">${escapeHtml(entry.homeroom)}</span>
          <span class="leaderboard-grade">${escapeHtml(gradeLabelClient(entry.grade))}</span>
        </span>
        <span class="leaderboard-percent">${entry.percentCorrect}%</span>
      </li>
    `;
  }).join("");
}

function renderGradeComparison(grades) {
  leaderboardEls.message.textContent = grades.length ? "" : "No grade data yet.";

  leaderboardEls.list.innerHTML = grades.map((entry, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const studentCount = entry.studentCount === 1 ? "1 student" : `${entry.studentCount} students`;

    return `
      <li class="leaderboard-row rank-${rank <= 3 ? rank : "other"}">
        <span class="leaderboard-rank">${medal}</span>
        <span class="leaderboard-name">
          <span class="leaderboard-homeroom">${escapeHtml(gradeLabelClient(entry.grade))}</span>
          <span class="leaderboard-grade">${escapeHtml(studentCount)}</span>
        </span>
        <span class="leaderboard-percent">${entry.percentCorrect}%</span>
      </li>
    `;
  }).join("");
}

function gradeLabelClient(grade) {
  const map = { "5": "5th Grade", "6": "6th Grade", "7": "7th Grade", "8": "8th Grade" };
  return map[grade] || "All Grades";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", initLeaderboard);

/***** TEACHER DASHBOARD *****/

const teacherEls = {
  openButton: document.getElementById("openTeacherButton"),
  panel: document.getElementById("teacherPanel"),
  closeButton: document.getElementById("closeTeacherButton"),
  loginView: document.getElementById("teacherLoginView"),
  loginForm: document.getElementById("teacherLoginForm"),
  passwordInput: document.getElementById("teacherPasswordInput"),
  loginMessage: document.getElementById("teacherLoginMessage"),
  manageView: document.getElementById("teacherManageView"),
  gradeSelect: document.getElementById("teacherGradeSelect"),
  subjectSelect: document.getElementById("teacherSubjectSelect"),
  manageMessage: document.getElementById("teacherManageMessage"),
  cardList: document.getElementById("teacherCardList")
};

const teacherState = {
  password: "",
  cardsMeta: [],
  hiddenCardIds: []
};

function initTeacherDashboard() {
  if (!teacherEls.openButton) return; // teacher markup isn't on this page

  teacherEls.openButton.addEventListener("click", openTeacherDashboard);
  teacherEls.closeButton.addEventListener("click", closeTeacherDashboard);
  teacherEls.loginForm.addEventListener("submit", handleTeacherLogin);
  teacherEls.gradeSelect.addEventListener("change", loadTeacherCards);
  teacherEls.subjectSelect.addEventListener("change", loadTeacherCards);
}

function openTeacherDashboard() {
  document.getElementById("loginPanel")?.classList.add("hidden");
  document.getElementById("dashboardPanel")?.classList.add("hidden");
  document.getElementById("practicePanel")?.classList.add("hidden");
  document.getElementById("leaderboardPanel")?.classList.add("hidden");
  teacherEls.panel.classList.remove("hidden");

  if (teacherState.password) {
    showTeacherManageView();
  } else {
    showTeacherLoginView();
  }
}

function closeTeacherDashboard() {
  teacherEls.panel.classList.add("hidden");
  document.getElementById("loginPanel")?.classList.remove("hidden");
}

function showTeacherLoginView() {
  teacherEls.loginView.classList.remove("hidden");
  teacherEls.manageView.classList.add("hidden");
  teacherEls.passwordInput.value = "";
  setMessage(teacherEls.loginMessage, "", "");
}

function showTeacherManageView() {
  teacherEls.loginView.classList.add("hidden");
  teacherEls.manageView.classList.remove("hidden");
  loadTeacherCards();
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  const password = teacherEls.passwordInput.value;

  setMessage(teacherEls.loginMessage, "Checking password...", "");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "checkTeacherPassword", password })
    });
    const data = await response.json();

    if (!data.found) {
      setMessage(teacherEls.loginMessage, data.error || "Incorrect password.", "error");
      return;
    }

    teacherState.password = password;
    showTeacherManageView();
  } catch (error) {
    setMessage(teacherEls.loginMessage, "Could not check the password. Please try again.", "error");
  }
}

async function loadTeacherCards() {
  const grade = teacherEls.gradeSelect.value;
  const subject = teacherEls.subjectSelect.value;

  setMessage(teacherEls.manageMessage, "Loading cards...", "");
  teacherEls.cardList.innerHTML = "";

  try {
    const [cardsMeta, hiddenCardIds] = await Promise.all([
      fetchCardsMetaFor(grade, subject),
      fetchHiddenCardIds(grade, subject)
    ]);

    teacherState.cardsMeta = cardsMeta;
    teacherState.hiddenCardIds = hiddenCardIds;

    renderTeacherCards();
  } catch (error) {
    setMessage(teacherEls.manageMessage, "Could not load cards. Please try again.", "error");
  }
}

async function fetchCardsMetaFor(grade, subject) {
  const path = `${getSubjectFolder(grade, subject)}/cards.json?v=${Date.now()}`;

  try {
    const response = await fetch(path);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function groupCardsByUnit(cardsMeta) {
  const groups = new Map();

  [...cardsMeta]
    .sort((a, b) => normalizeCardId(a.id).localeCompare(normalizeCardId(b.id), undefined, { numeric: true }))
    .forEach(card => {
      const cardId = normalizeCardId(card.id);
      if (!cardId) return;

      const unit = normalizeUnitLabel(card.unit) || getUnitForCardId(cardId);
      if (!groups.has(unit)) groups.set(unit, []);
      groups.get(unit).push(cardId);
    });

  return [...groups.entries()]
    .map(([unit, cardIds]) => ({ unit, cardIds }))
    .sort((a, b) => sortUnitLabels(a.unit, b.unit));
}

function getUnitVisibilityState(cardIds, hiddenSet) {
  const hiddenCount = cardIds.filter(cardId => hiddenSet.has(cardId)).length;
  if (hiddenCount === 0) return "visible";
  if (hiddenCount === cardIds.length) return "hidden";
  return "mixed";
}

function renderTeacherCards() {
  if (!teacherState.cardsMeta.length) {
    teacherEls.cardList.innerHTML = "";
    setMessage(teacherEls.manageMessage, "No cards found for this grade and subject yet.", "");
    return;
  }

  setMessage(teacherEls.manageMessage, "", "");

  const hiddenSet = new Set(teacherState.hiddenCardIds.map(normalizeCardId));
  const unitGroups = groupCardsByUnit(teacherState.cardsMeta);

  teacherEls.cardList.innerHTML = unitGroups.map(({ unit, cardIds }) => {
    const unitState = getUnitVisibilityState(cardIds, hiddenSet);
    const nextHidden = unitState === "visible";

    const statusText = unitState === "hidden"
      ? "Hidden from Students"
      : unitState === "mixed"
        ? "Some Cards Hidden"
        : "Visible to Students";

    const actionText = unitState === "visible"
      ? "Hide Unit"
      : unitState === "mixed"
        ? "Show Remaining"
        : "Show Unit";

    const pills = cardIds.map(cardId => {
      const isHidden = hiddenSet.has(cardId);
      return `
        <button
          type="button"
          class="teacher-card-pill ${isHidden ? "toggle-hidden" : "toggle-visible"}"
          data-card-id="${escapeHtml(cardId)}"
        >${escapeHtml(cardId)}</button>
      `;
    }).join("");

    return `
      <div class="teacher-unit-group">
        <button
          type="button"
          class="teacher-unit-bar unit-${unitState}"
          data-card-ids="${escapeHtml(cardIds.join(","))}"
          data-next-hidden="${nextHidden}"
        >
          <span>${escapeHtml(unit)} — ${escapeHtml(statusText)}</span>
          <span>${escapeHtml(actionText)}</span>
        </button>
        <div class="teacher-unit-cards">${pills}</div>
      </div>
    `;
  }).join("");

  teacherEls.cardList.querySelectorAll(".teacher-unit-bar").forEach(bar => {
    bar.addEventListener("click", () => toggleUnitVisibility(bar));
  });

  teacherEls.cardList.querySelectorAll(".teacher-card-pill").forEach(pill => {
    pill.addEventListener("click", () => toggleCardVisibility(pill));
  });
}

async function requestSetCardVisibility(cardId, hidden) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "setCardVisibility",
      password: teacherState.password,
      grade: teacherEls.gradeSelect.value,
      subject: teacherEls.subjectSelect.value,
      cardId: cardId,
      hidden: hidden
    })
  });
  return response.json();
}

function applyHiddenState(cardIds, hidden) {
  const hiddenSet = new Set(teacherState.hiddenCardIds.map(normalizeCardId));
  cardIds.forEach(cardId => {
    if (hidden) hiddenSet.add(cardId);
    else hiddenSet.delete(cardId);
  });
  teacherState.hiddenCardIds = [...hiddenSet];
}

async function toggleCardVisibility(pill) {
  const cardId = pill.dataset.cardId;
  const nextHidden = !pill.classList.contains("toggle-hidden");

  pill.disabled = true;

  try {
    const data = await requestSetCardVisibility(cardId, nextHidden);

    if (!data.found) {
      setMessage(teacherEls.manageMessage, data.error || "Could not update that card.", "error");
      return;
    }

    applyHiddenState([cardId], nextHidden);
    renderTeacherCards();
  } catch (error) {
    setMessage(teacherEls.manageMessage, "Could not update that card. Please try again.", "error");
  } finally {
    pill.disabled = false;
  }
}

async function toggleUnitVisibility(bar) {
  const cardIds = bar.dataset.cardIds.split(",").filter(Boolean);
  const nextHidden = bar.dataset.nextHidden === "true";

  bar.disabled = true;
  setMessage(teacherEls.manageMessage, nextHidden ? "Hiding unit..." : "Showing unit...", "");

  try {
    const results = await Promise.all(cardIds.map(cardId => requestSetCardVisibility(cardId, nextHidden)));
    const failed = results.find(result => !result.found);

    if (failed) {
      setMessage(teacherEls.manageMessage, failed.error || "Could not update this unit.", "error");
    } else {
      setMessage(teacherEls.manageMessage, "", "");
    }

    applyHiddenState(cardIds, nextHidden);
    renderTeacherCards();
  } catch (error) {
    setMessage(teacherEls.manageMessage, "Could not update this unit. Please try again.", "error");
  } finally {
    bar.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", initTeacherDashboard);
