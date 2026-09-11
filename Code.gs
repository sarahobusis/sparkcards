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

function doGet(e) {
  try {
    const params = e.parameter || {};

    if (params.action === "leaderboard") {
      const grade = cleanGrade(params.grade);       // "" means "all grades"
      const subject = cleanSubject(params.subject);  // "" means "all subjects"
      const result = getLeaderboardData(grade, subject);
      return jsonResponse(result);
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

        let points = 0;
        let counted = 0;

        cardHeaders.forEach((cardId, index) => {
          if (!cardId) return;
          const score = normalizeScore(row[firstCardCol - 1 + index]);
          if (score === "") return; // blank cards don't count toward the average
          points += score;
          counted += 1;
        });

        if (counted === 0) return; // student hasn't attempted anything yet

        const studentPercent = (points / counted) * 100;
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
    homerooms: homerooms
  };
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
