/***** STAR CARD STUDENT DASHBOARD API *****/

const SPREADSHEETS_BY_GRADE = {
  "5": "1JVvy7hImPv3-xtwHFdysXJjZoC99z1VODR5OkOYaeHg",
  "6": "1QgjCVDsuMl3RGridk49tfPVqjcIWNDCRndxxMwtJ98w",
  "7": "1PoqqvfmN0g9v7iuCxCqG1OBaNRjIg7f0CHmD3cGXXIY",
  "8": "1ZUBQLvtN-Mq2A06yGKcH_hoI-HG2uBnuRNuEeFY7M7Y"
};

const ALLOWED_SUBJECTS = ["Math", "Science", "History"];

// Spreadsheet layout
const HEADER_ROW = 3;
const FIRST_STUDENT_ROW = 4;
const STAR_CARD_ID_COL = 2; // B
const HOMEROOM_COL = 6; // F

// Card visibility (teacher dashboard)
const CARD_VISIBILITY_SHEET_NAME = "CardVisibility";
const TEACHER_PASSWORD = "sparkstaff";

function doGet(e) {
  try {
    const params = e.parameter || {};

    if (params.action === "leaderboard") {
      const grade = cleanGrade(params.grade);       // "" means "all grades"
      const subject = cleanSubject(params.subject);  // "" means "all subjects"
      const result = getLeaderboardData(grade, subject);
      return jsonResponse(result);
    }

    if (params.action === "cardVisibility") {
      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);

      if (!grade || !subject) {
        return jsonResponse({ found: false, error: "Missing grade or subject." });
      }

      return jsonResponse({
        found: true,
        hiddenCardIds: getHiddenCardIds(grade, subject)
      });
    }

    // New name is starCardId. Keeping lasid as a backup makes old links/tests not totally break.
    const starCardId = cleanStudentId(params.starCardId || params.lasid);
    const grade = cleanGrade(params.grade);
    const subject = cleanSubject(params.subject);

    if (!starCardId || !grade || !subject) {
      return jsonResponse({
        found: false,
        error: "Missing STAR Card ID, grade, or subject."
      });
    }

    const result = getStudentDashboardData(starCardId, grade, subject);
    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({
      found: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function doPost(e) {
  try {
    const params = JSON.parse((e.postData && e.postData.contents) || "{}");

    if (params.action === "checkTeacherPassword") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }
      return jsonResponse({ found: true });
    }

    if (params.action === "setCardVisibility") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }

      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);
      const cardId = normalizeCardId(params.cardId);
      const hidden = !!params.hidden;

      if (!grade || !subject || !cardId) {
        return jsonResponse({ found: false, error: "Missing grade, subject, or cardId." });
      }

      if (!SPREADSHEETS_BY_GRADE[grade]) {
        return jsonResponse({ found: false, error: "No spreadsheet is connected for grade " + grade + " yet." });
      }

      setCardVisibility(grade, subject, cardId, hidden);
      return jsonResponse({ found: true });
    }

    if (params.action === "gradeAnswer") {
      const studentAnswer = String(params.studentAnswer || "").trim();
      const correctAnswerText = String(params.correctAnswerText || "").trim();
      const questionText = String(params.questionText || "").trim();
      const language = params.language === "es" ? "es" : "en";

      if (!studentAnswer) {
        return jsonResponse({ found: false, error: "Type an answer first." });
      }

      if (!correctAnswerText) {
        return jsonResponse({ found: false, error: "Answer feedback is not available for this card yet." });
      }

      return jsonResponse(gradeStudentAnswer(questionText, correctAnswerText, studentAnswer, language));
    }

    return jsonResponse({ found: false, error: "Unknown action." });

  } catch (err) {
    return jsonResponse({
      found: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function getStudentDashboardData(starCardId, grade, subject) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];

  if (!spreadsheetId) {
    return {
      found: false,
      error: "No spreadsheet is connected for grade " + grade + " yet."
    };
  }

  if (!ALLOWED_SUBJECTS.includes(subject)) {
    return {
      found: false,
      error: "Subject must be Math, Science, or History."
    };
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(subject);

  if (!sheet) {
    return {
      found: false,
      error: "Could not find the " + subject + " tab."
    };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < FIRST_STUDENT_ROW) {
    return {
      found: false,
      error: "This sheet does not have enough student data yet."
    };
  }

  const headerValues = sheet
    .getRange(HEADER_ROW, 1, 1, lastCol)
    .getValues()[0];

  const percentMasteredCol = findPercentMasteredCol(headerValues);
  const totalMasteredCol = findTotalMasteredCol(headerValues);
  const firstCardCol = findFirstCardCol(headerValues);

  if (!firstCardCol) {
    return {
      found: false,
      error: "Could not find the first card column in row 3."
    };
  }

  const cardHeaders = sheet
    .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
    .getValues()[0]
    .map(normalizeCardId);

  const studentData = sheet
    .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
    .getValues();

  const matchingRow = studentData.find(row => {
    return cleanStudentId(row[STAR_CARD_ID_COL - 1]) === starCardId;
  });

  if (!matchingRow) {
    return {
      found: false,
      error: "We could not find that STAR Card ID for this grade and subject."
    };
  }

  const cards = {};

  cardHeaders.forEach((cardId, index) => {
    if (!cardId) return;

    const rawValue = matchingRow[firstCardCol - 1 + index];
    cards[cardId] = normalizeScore(rawValue);
  });

  // Hide cards the teacher has toggled off, without touching the sheet's
  // own columns or scores — a hidden card just doesn't show up here.
  getHiddenCardIds(grade, subject).forEach(hiddenId => {
    delete cards[hiddenId];
  });

  return {
    found: true,
    grade: grade,
    subject: subject,
    percentMastered: percentMasteredCol
      ? normalizePercent(matchingRow[percentMasteredCol - 1])
      : "",
    totalCardsMastered: totalMasteredCol
      ? normalizeNumber(matchingRow[totalMasteredCol - 1])
      : "",
    cards: cards
  };
}

/***** TEACHER DASHBOARD: CARD VISIBILITY *****/
//
// Visibility state lives in its own "CardVisibility" tab per grade
// spreadsheet (columns: Subject, CardId, Hidden), completely separate from
// the Math/Science/History tabs. This is deliberate: every uploaded card
// keeps its own column and scores on the subject tabs whether or not a
// teacher has hidden it from students.

function getOrCreateVisibilitySheet(ss) {
  let sheet = ss.getSheetByName(CARD_VISIBILITY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CARD_VISIBILITY_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([["Subject", "CardId", "Hidden"]]);
  }

  return sheet;
}

function getHiddenCardIds(grade, subject) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return [];

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(CARD_VISIBILITY_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const hiddenCardIds = [];

  values.forEach(row => {
    const rowSubject = cleanSubject(row[0]);
    const cardId = normalizeCardId(row[1]);
    const isHidden = row[2] === true || String(row[2]).trim().toLowerCase() === "true";

    if (rowSubject === subject && cardId && isHidden) {
      hiddenCardIds.push(cardId);
    }
  });

  return hiddenCardIds;
}

function setCardVisibility(grade, subject, cardId, hidden) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return;

  // The teacher dashboard can toggle a whole unit at once, which fires one
  // request per card in parallel. Without a lock, two concurrent requests
  // could both miss each other's row and append duplicates for different
  // cards at the same time.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = getOrCreateVisibilitySheet(ss);
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

      for (let i = 0; i < values.length; i++) {
        const rowSubject = cleanSubject(values[i][0]);
        const rowCardId = normalizeCardId(values[i][1]);

        if (rowSubject === subject && rowCardId === cardId) {
          sheet.getRange(i + 2, 3).setValue(hidden);
          return;
        }
      }
    }

    sheet.appendRow([subject, cardId, hidden]);
  } finally {
    lock.releaseLock();
  }
}

/***** TYPED ANSWER FEEDBACK *****/
//
// Grades a student's typed answer with Claude instead of an exact-match or
// similarity check: spelling is often bad, math notation is hard to type,
// and there are many valid ways to phrase a correct explanation. The API
// key never reaches the browser — it lives in this script's Script
// Properties (Project Settings > Script Properties in the Apps Script
// editor), not in this file, so it never ends up in the GitHub repo.

const ANTHROPIC_MODEL = "claude-opus-5";

function gradeStudentAnswer(questionText, correctAnswerText, studentAnswer, language) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");

  if (!apiKey) {
    return {
      found: false,
      error: "Answer feedback isn't set up yet. Ask your teacher to add the Anthropic API key."
    };
  }

  const feedbackLanguageInstruction = language === "es"
    ? "Write the feedback in Spanish."
    : "Write the feedback in English.";

  const systemPrompt = [
    "You are grading a student's short typed answer for a K-8 study flashcard app.",
    "Be encouraging and lenient when judging correctness:",
    "- Ignore spelling, capitalization, punctuation, and grammar mistakes entirely.",
    "- Students often type math notation imperfectly (for example \"10^3\", \"10 to the 3rd power\", \"1/2\", and \"0.5\" can all be equivalent). Treat mathematically equivalent expressions as the same.",
    "- There are often multiple valid ways to phrase a correct explanation. Judge whether the student's answer conveys the same idea as the reference answer, not whether the wording matches.",
    "- If the question has multiple parts and the student only got some of them right, use \"partial\".",
    "- If the answer is blank, off-topic, or shows a clear misunderstanding, use \"incorrect\".",
    "- If the student's answer correctly conveys the key idea(s), use \"correct\", even if it is brief or phrased very differently from the reference answer.",
    feedbackLanguageInstruction + " Keep the feedback to one short, warm sentence (no more than 20 words). Do not quote or reveal the reference answer's exact wording in the feedback — the student can already reveal the full answer with a separate button."
  ].join("\n");

  const userPrompt =
    "Question:\n" + (questionText || "(not provided)") +
    "\n\nReference answer:\n" + correctAnswerText +
    "\n\nStudent's typed answer:\n" + studentAnswer;

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            result: { type: "string", enum: ["correct", "partial", "incorrect"] },
            feedback: { type: "string" }
          },
          required: ["result", "feedback"],
          additionalProperties: false
        }
      }
    }
  };

  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    return { found: false, error: "Could not check that answer right now. Please try again." };
  }

  const body = JSON.parse(response.getContentText());
  const textBlock = (body.content || []).find(block => block.type === "text");

  if (!textBlock) {
    return { found: false, error: "Could not check that answer right now. Please try again." };
  }

  const parsed = JSON.parse(textBlock.text);

  return {
    found: true,
    result: parsed.result,
    feedback: parsed.feedback
  };
}

/***** CLASS LEADERBOARD *****/

function getLeaderboardData(grade, subject) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "leaderboard:" + (grade || "all") + ":" + (subject || "all");
  const cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const result = buildLeaderboardData(grade, subject);
  cache.put(cacheKey, JSON.stringify(result), 300); // cache for 5 minutes
  return result;
}

function buildLeaderboardData(grade, subject) {
  const grades = grade ? [grade] : Object.keys(SPREADSHEETS_BY_GRADE);
  const subjects = subject ? [subject] : ALLOWED_SUBJECTS;

  // Key: "grade|homeroom" -> running totals
  const homeroomTotals = {};

  grades.forEach(g => {
    const spreadsheetId = SPREADSHEETS_BY_GRADE[g];
    if (!spreadsheetId) return;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    subjects.forEach(subj => {
      const sheet = ss.getSheetByName(subj);
      if (!sheet) return;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < FIRST_STUDENT_ROW) return;

      const headerValues = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
      const firstCardCol = findFirstCardCol(headerValues);
      if (!firstCardCol) return;

      const cardHeaders = sheet
        .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
        .getValues()[0]
        .map(normalizeCardId);

      const rows = sheet
        .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
        .getValues();

      rows.forEach(row => {
        const homeroom = String(row[HOMEROOM_COL - 1] || "").trim();
        if (!homeroom) return;

        const studentPercent = computeStudentPercent(row, cardHeaders, firstCardCol);
        if (studentPercent === null) return; // student hasn't attempted anything yet

        const key = g + "|" + homeroom;

        if (!homeroomTotals[key]) {
          homeroomTotals[key] = { grade: g, homeroom: homeroom, sumPercent: 0, studentCount: 0 };
        }

        homeroomTotals[key].sumPercent += studentPercent;
        homeroomTotals[key].studentCount += 1;
      });
    });
  });

  const homerooms = Object.values(homeroomTotals).map(entry => ({
    grade: entry.grade,
    homeroom: entry.homeroom,
    studentCount: entry.studentCount,
    percentCorrect: Math.round(entry.sumPercent / entry.studentCount)
  }));

  homerooms.sort((a, b) => b.percentCorrect - a.percentCorrect);

  return {
    found: true,
    scope: {
      grade: grade ? gradeLabel(grade) : "All Grades",
      subject: subject || "All Subjects"
    },
    generatedAt: new Date().toISOString(),
    homerooms: homerooms,
    grades: buildGradeComparisonData(subject) // always spans all grades, regardless of the grade filter
  };
}

function computeStudentPercent(row, cardHeaders, firstCardCol) {
  let points = 0;
  let counted = 0;

  cardHeaders.forEach((cardId, index) => {
    if (!cardId) return;
    const score = normalizeScore(row[firstCardCol - 1 + index]);
    if (score === "") return; // blank cards don't count toward the average
    points += score;
    counted += 1;
  });

  if (counted === 0) return null;
  return (points / counted) * 100;
}

function buildGradeComparisonData(subject) {
  const subjects = subject ? [subject] : ALLOWED_SUBJECTS;
  const gradeTotals = {};

  Object.keys(SPREADSHEETS_BY_GRADE).forEach(g => {
    const spreadsheetId = SPREADSHEETS_BY_GRADE[g];
    if (!spreadsheetId) return;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    subjects.forEach(subj => {
      const sheet = ss.getSheetByName(subj);
      if (!sheet) return;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < FIRST_STUDENT_ROW) return;

      const headerValues = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
      const firstCardCol = findFirstCardCol(headerValues);
      if (!firstCardCol) return;

      const cardHeaders = sheet
        .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
        .getValues()[0]
        .map(normalizeCardId);

      const rows = sheet
        .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
        .getValues();

      rows.forEach(row => {
        const studentPercent = computeStudentPercent(row, cardHeaders, firstCardCol);
        if (studentPercent === null) return;

        if (!gradeTotals[g]) {
          gradeTotals[g] = { grade: g, sumPercent: 0, studentCount: 0 };
        }

        gradeTotals[g].sumPercent += studentPercent;
        gradeTotals[g].studentCount += 1;
      });
    });
  });

  const gradeAverages = Object.values(gradeTotals).map(entry => ({
    grade: entry.grade,
    studentCount: entry.studentCount,
    percentCorrect: Math.round(entry.sumPercent / entry.studentCount)
  }));

  gradeAverages.sort((a, b) => b.percentCorrect - a.percentCorrect);

  return gradeAverages;
}

function gradeLabel(grade) {
  const map = { "5": "5th Grade", "6": "6th Grade", "7": "7th Grade", "8": "8th Grade" };
  return map[grade] || grade;
}

function findPercentMasteredCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const text = String(headers[i] || "").toLowerCase();
    if (
      text.includes("%") ||
      text.includes("percent") ||
      text.includes("cards mastered to date")
    ) {
      return i + 1;
    }
  }

  return null;
}

function findTotalMasteredCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const text = String(headers[i] || "").toLowerCase();
    if (text.includes("total cards mastered")) {
      return i + 1;
    }
  }

  return null;
}

function findFirstCardCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const cardId = normalizeCardId(headers[i]);

    // Matches card IDs like 0A, 1A, 1B, 2C, 10D, etc.
    if (/^\d+[A-Z]+$/.test(cardId)) {
      return i + 1;
    }
  }

  return null;
}

function cleanStudentId(value) {
  return String(value || "").trim();
}

function cleanGrade(value) {
  const text = String(value || "").trim();

  if (text === "5th Grade") return "5";
  if (text === "6th Grade") return "6";
  if (text === "7th Grade") return "7";
  if (text === "8th Grade") return "8";

  return text.replace(/\D/g, "");
}

function cleanSubject(value) {
  const text = String(value || "").trim().toLowerCase();

  if (text === "math") return "Math";
  if (text === "science") return "Science";
  if (text === "history") return "History";

  return "";
}

function normalizeCardId(value) {
  return String(value || "")
    .trim()
    .replace(/\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeScore(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return "";
  }

  const text = String(value)
    .trim()
    .replace("%", "")
    .replace("½", "0.5");

  if (text === "1" || text === "1.0") return 1;
  if (text === "0.5" || text === ".5") return 0.5;
  if (text === "0" || text === "0.0") return 0;

  const num = Number(text);

  if (Math.abs(num - 1) < 0.00001) return 1;
  if (Math.abs(num - 0.5) < 0.00001) return 0.5;
  if (Math.abs(num - 0) < 0.00001) return 0;

  return "";
}

function normalizePercent(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "number") {
    if (value <= 1) return Math.round(value * 100);
    return Math.round(value);
  }

  const text = String(value).replace("%", "").trim();
  const num = Number(text);

  if (isNaN(num)) return "";

  if (num <= 1) return Math.round(num * 100);
  return Math.round(num);
}

function normalizeNumber(value) {
  const num = Number(value);
  if (isNaN(num)) return "";
  return num;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/***** QUICK TEST *****/

function testLookup() {
  // Replace TEST123 with a STAR Card ID from column B.
  const result = getStudentDashboardData("TEST123", "5", "Math");
  Logger.log(JSON.stringify(result, null, 2));
}

function testLeaderboard() {
  const result = getLeaderboardData("", ""); // all grades, all subjects
  Logger.log(JSON.stringify(result, null, 2));
}

/***** OPTIONAL: CHECK FOR DUPLICATE CARD HEADERS *****/

function checkDuplicateCardHeaders() {
  const grades = Object.keys(SPREADSHEETS_BY_GRADE);
  const subjects = ["Math", "Science", "History"];

  grades.forEach(grade => {
    const ss = SpreadsheetApp.openById(SPREADSHEETS_BY_GRADE[grade]);

    subjects.forEach(subject => {
      const sheet = ss.getSheetByName(subject);
      if (!sheet) {
        Logger.log("Grade " + grade + " " + subject + ": tab not found");
        return;
      }

      const lastCol = sheet.getLastColumn();
      const headers = sheet
        .getRange(HEADER_ROW, 1, 1, lastCol)
        .getValues()[0]
        .map(normalizeCardId)
        .filter(id => /^\d+[A-Z]+$/.test(id));

      const seen = {};
      const duplicates = [];

      headers.forEach(id => {
        if (seen[id]) duplicates.push(id);
        seen[id] = true;
      });

      if (duplicates.length === 0) {
        Logger.log("Grade " + grade + " " + subject + ": no duplicate card headers");
      } else {
        Logger.log("Grade " + grade + " " + subject + ": duplicate card headers → " + duplicates.join(", "));
      }
    });
  });
}
