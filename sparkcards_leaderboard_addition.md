# SparkCards: Class Leaderboard Addition

## What this adds

A "Class Leaderboard" view that ranks **homerooms** (never individual students) by
average % correct, with optional Grade and Subject filters ("All Grades" / "All
Subjects" included). It refreshes each time a student opens the leaderboard, and
is cached on the server for 5 minutes so it doesn't hit your spreadsheets on every
click if a lot of kids open it around the same time.

**How % correct is calculated:** for each student, `points / cards attempted`,
where mastered = 1 point, partial = 0.5 point, incorrect = 0 point, and blank
cards are skipped entirely (not counted as 0). Each homeroom's score is the
**average of its students' individual percentages** — so a homeroom isn't
penalized just because one kid has attempted way more cards than another.

**Homeroom column:** hardcoded to column F, the same way your script already
hardcodes `STAR_CARD_ID_COL = 2` for column B. If any grade's sheet ever puts
Homeroom in a different column, let me know and I'll adjust.

---

## 1. Additions to `Code.gs`

### Add this constant near your existing `STAR_CARD_ID_COL` line:

```javascript
const HOMEROOM_COL = 6; // Column F
```

### Replace your existing `doGet` function with this:

```javascript
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
```

### Add these new functions anywhere below (e.g. right after `getStudentDashboardData`):

```javascript
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
```

After pasting, redeploy: **Deploy → Manage deployments → Edit → Version: New version → Deploy.**

### Quick test (optional)

Add this alongside your existing `testLookup`:

```javascript
function testLeaderboard() {
  const result = getLeaderboardData("", ""); // all grades, all subjects
  Logger.log(JSON.stringify(result, null, 2));
}
```

---

## 2. Additions to `index.html`

Add a link to the leaderboard inside your existing `#loginPanel`, right after the
`lookupMessage` paragraph:

```html
<button type="button" id="openLeaderboardButton" class="small-button leaderboard-link-button">🏆 Class Leaderboard</button>
```

Add the new panel itself — place it as a sibling of `#dashboardPanel` and
`#practicePanel`, inside `<main class="page-shell">`:

```html
<section class="panel leaderboard-panel hidden" id="leaderboardPanel">
  <div class="dashboard-topline">
    <button id="closeLeaderboardButton" class="small-button">← Back</button>
    <div>
      <p class="eyebrow">Spark Academy</p>
      <h2>Class Leaderboard</h2>
    </div>
  </div>

  <p class="helper">Homeroom averages only — no individual student names or scores are shown.</p>

  <div class="leaderboard-filters">
    <label>
      Grade
      <select id="leaderboardGradeFilter">
        <option value="">All Grades</option>
        <option value="5">5th Grade</option>
        <option value="6">6th Grade</option>
        <option value="7">7th Grade</option>
        <option value="8">8th Grade</option>
      </select>
    </label>
    <label>
      Subject
      <select id="leaderboardSubjectFilter">
        <option value="">All Subjects</option>
        <option value="Math">Math</option>
        <option value="Science">Science</option>
        <option value="History">History</option>
      </select>
    </label>
  </div>

  <p id="leaderboardMessage" class="message" role="status"></p>
  <p id="leaderboardUpdatedText" class="leaderboard-updated"></p>

  <ol id="leaderboardList" class="leaderboard-list"></ol>
</section>
```

---

## 3. Additions to `styles.css`

Add anywhere in the file:

```css
.leaderboard-link-button {
  margin-top: 16px;
}

.leaderboard-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 16px 0;
}

.leaderboard-updated {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 12px;
}

.leaderboard-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.leaderboard-row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: #fbfcff;
}

.leaderboard-row.rank-1 { background: #fff7db; border-color: var(--yellow); }
.leaderboard-row.rank-2 { background: #f4f6f9; border-color: #c9d2de; }
.leaderboard-row.rank-3 { background: #fdeee2; border-color: #f0c19a; }

.leaderboard-rank {
  font-size: 22px;
  font-weight: 900;
  text-align: center;
  color: var(--blue-dark);
}

.leaderboard-name {
  display: grid;
  gap: 2px;
}

.leaderboard-homeroom {
  font-weight: 700;
}

.leaderboard-grade {
  font-size: 13px;
  color: var(--muted);
}

.leaderboard-percent {
  font-size: 22px;
  font-weight: 900;
  color: var(--blue);
}

@media (max-width: 800px) {
  .leaderboard-filters {
    flex-direction: column;
  }
}
```

---

## 4. Additions to `app.js`

Add this block anywhere in the file (it's self-contained and doesn't touch your
existing `els` object or state):

```javascript
/***** CLASS LEADERBOARD *****/

const leaderboardEls = {
  openButton: document.getElementById("openLeaderboardButton"),
  panel: document.getElementById("leaderboardPanel"),
  closeButton: document.getElementById("closeLeaderboardButton"),
  gradeFilter: document.getElementById("leaderboardGradeFilter"),
  subjectFilter: document.getElementById("leaderboardSubjectFilter"),
  list: document.getElementById("leaderboardList"),
  message: document.getElementById("leaderboardMessage"),
  updatedText: document.getElementById("leaderboardUpdatedText")
};

function initLeaderboard() {
  if (!leaderboardEls.openButton) return; // leaderboard markup isn't on this page

  leaderboardEls.openButton.addEventListener("click", openLeaderboard);
  leaderboardEls.closeButton.addEventListener("click", closeLeaderboard);
  leaderboardEls.gradeFilter.addEventListener("change", loadLeaderboard);
  leaderboardEls.subjectFilter.addEventListener("change", loadLeaderboard);
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

    renderLeaderboard(data);
  } catch (error) {
    leaderboardEls.message.textContent = "Could not load the leaderboard. Please try again.";
  }
}

function renderLeaderboard(data) {
  leaderboardEls.message.textContent = data.homerooms.length ? "" : "No homeroom data yet.";

  const updated = new Date(data.generatedAt);
  leaderboardEls.updatedText.textContent =
    `Updated ${updated.toLocaleDateString()} at ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  leaderboardEls.list.innerHTML = data.homerooms.map((entry, index) => {
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
```

---

## Deploy checklist

1. Paste the `Code.gs` changes → **Deploy → Manage deployments → Edit → New version → Deploy**.
2. Upload the updated `index.html`, `styles.css`, `app.js` to GitHub.
3. Hard refresh (`Command + Shift + R`) and click **🏆 Class Leaderboard** from the sign-in page to test.
4. If a homeroom is missing from the leaderboard, the most likely cause is a blank cell in column F for those students — check that grade's sheet.
