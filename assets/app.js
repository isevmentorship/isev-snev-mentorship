/* ============================================
   ISEV–SNEV Mentorship Program · Prototype
   Front-end only. No data is saved or sent.
   ============================================ */

(function () {
  "use strict";

  // ----- Sample data -----
  // Candidate mentors shown to a mentee applicant.
  const MENTOR_CANDIDATES = [
    {
      code: "M-A417",
      initials: "M1",
      realName: "Dr. Priya Raman",
      realInstitution: "Karolinska Institutet",
      career: "Associate Professor · 12 yrs EV research",
      focus: "EV biomarkers in Parkinson's disease",
      timezone: "CET (UTC+1)",
      tags: ["grant writing", "neurodegeneration", "biomarkers"],
      strengths: "Has mentored 9 postdocs through independence transitions.",
      score: "94% fit"
    },
    {
      code: "M-B209",
      initials: "M2",
      realName: "Dr. Luca Moretti",
      realInstitution: "University of Bologna",
      career: "Senior Staff Scientist · industry background",
      focus: "EVs as therapeutic delivery vehicles",
      timezone: "CET (UTC+1)",
      tags: ["industry transition", "regulatory", "scale-up"],
      strengths: "Bridges academia and industry; fluent in regulatory strategy.",
      score: "88% fit"
    },
    {
      code: "M-C052",
      initials: "M3",
      realName: "Dr. Chen Wei",
      realInstitution: "National University of Singapore",
      career: "PI · runs a cross-disciplinary EV lab",
      focus: "Single-vesicle imaging and nanoflow cytometry",
      timezone: "SGT (UTC+8)",
      tags: ["imaging", "method development", "cross-disciplinary"],
      strengths: "Strong on experimental design and building collaborative teams.",
      score: "81% fit"
    }
  ];

  // Candidate mentees shown to a mentor applicant.
  const MENTEE_CANDIDATES = [
    {
      code: "T-D882",
      initials: "T1",
      realName: "Amira Hassan",
      realInstitution: "University of Cape Town",
      career: "PhD candidate · Year 3",
      focus: "EVs in tuberculosis host response",
      timezone: "SAST (UTC+2)",
      tags: ["infectious disease", "proteomics", "career planning"],
      strengths: "Seeking advice on postdoc choices and first-author strategy.",
      score: "92% fit"
    },
    {
      code: "T-E140",
      initials: "T2",
      realName: "Jordan Peters",
      realInstitution: "Stanford University",
      career: "Postdoc · Year 1",
      focus: "EV biomarkers in traumatic brain injury",
      timezone: "PST (UTC-8)",
      tags: ["grant writing", "K99/R00", "biomarkers"],
      strengths: "Preparing a K99 application; wants feedback on specific aims.",
      score: "86% fit"
    },
    {
      code: "T-F523",
      initials: "T3",
      realName: "Sanjay Gupta",
      realInstitution: "AIIMS New Delhi",
      career: "Clinician-scientist · cardiology",
      focus: "Plasma EVs as cardiac injury biomarkers",
      timezone: "IST (UTC+5:30)",
      tags: ["clinical translation", "biomarkers", "cohort studies"],
      strengths: "Bridges clinic and bench; strong cohort-building experience.",
      score: "79% fit"
    }
  ];

  // ----- State -----
  const state = {
    role: null,                 // 'mentee' or 'mentor'
    step: 1,
    picks: new Set(),
    revealed: null              // which candidate gets revealed at step 5
  };

  // ----- DOM helpers -----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function show(step) {
    state.step = step;
    [1, 2, 3, 4, 5].forEach((n) => {
      const el = document.getElementById("screen-" + n);
      if (el) el.hidden = n !== step;
    });
    updateStepper();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStepper() {
    $$(".stepper .step").forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle("active", n === state.step);
      el.classList.toggle("done", n < state.step);
    });
  }

  function candidatesForRole() {
    return state.role === "mentor" ? MENTEE_CANDIDATES : MENTOR_CANDIDATES;
  }

  function renderMatches() {
    const container = $("#matchGrid");
    if (!container) return;
    container.innerHTML = "";
    const candidates = candidatesForRole();
    const counterpartLabel = state.role === "mentor" ? "mentees" : "mentors";
    const titleEl = $("#matchesTitle");
    if (titleEl) titleEl.textContent = "Here are your candidate " + counterpartLabel + ".";

    candidates.forEach((c) => {
      const card = document.createElement("article");
      card.className = "match-card";
      card.dataset.code = c.code;
      card.innerHTML = `
        <div class="score">${c.score}</div>
        <div class="avatar">${c.initials}</div>
        <div class="code">${c.code}</div>
        <h3 style="margin:0.4rem 0 0.3rem;">Anonymous candidate</h3>
        <dl>
          <dt>Career</dt><dd>${c.career}</dd>
          <dt>Focus</dt><dd>${c.focus}</dd>
          <dt>Time zone</dt><dd>${c.timezone}</dd>
        </dl>
        <div class="tags">
          ${c.tags.map((t) => `<span class="tag">${t}</span>`).join("")}
        </div>
        <p style="color:var(--muted);font-size:0.92rem;margin:0 0 1rem;">${c.strengths}</p>
        <div class="actions">
          <button class="btn btn-primary pick-btn" data-code="${c.code}">Select</button>
          <span class="select-label" data-code-label="${c.code}"></span>
        </div>
      `;
      container.appendChild(card);
    });

    // Wire up pick buttons
    $$(".pick-btn", container).forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const code = btn.dataset.code;
        togglePick(code);
      });
    });

    refreshPickUI();
  }

  function togglePick(code) {
    if (state.picks.has(code)) {
      state.picks.delete(code);
    } else {
      state.picks.add(code);
    }
    refreshPickUI();
  }

  function refreshPickUI() {
    const count = state.picks.size;
    const submit = $("#submitPicks");
    const pickCount = $("#pickCount");
    if (submit) submit.disabled = count === 0;
    if (pickCount) pickCount.textContent = count + " selected";

    $$(".match-card").forEach((card) => {
      const code = card.dataset.code;
      const selected = state.picks.has(code);
      card.classList.toggle("selected", selected);
      const btn = card.querySelector(".pick-btn");
      if (btn) btn.textContent = selected ? "Selected ✓" : "Select";
      const label = card.querySelector("[data-code-label]");
      if (label) label.textContent = selected ? "Added to your picks" : "";
    });
  }

  function renderPickList() {
    const list = $("#pickList");
    if (!list) return;
    list.innerHTML = "";
    const candidates = candidatesForRole();
    candidates.forEach((c) => {
      if (!state.picks.has(c.code)) return;
      const li = document.createElement("li");
      li.innerHTML = `<strong>${c.code}</strong> &mdash; ${c.focus} <span style="color:var(--muted);">(${c.timezone})</span>`;
      list.appendChild(li);
    });
  }

  function renderReveal() {
    const container = $("#revealCard");
    if (!container) return;
    // Pick the highest-ranked one the user actually selected.
    const candidates = candidatesForRole();
    const chosen = candidates.find((c) => state.picks.has(c.code)) || candidates[0];
    state.revealed = chosen;

    const counterpart = state.role === "mentor" ? "mentee" : "mentor";
    container.innerHTML = `
      <div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
        <div class="avatar">${chosen.initials}</div>
        <div style="flex:1;min-width:240px;">
          <h3 style="margin:0 0 0.2rem;">Your ${counterpart}: ${chosen.realName}</h3>
          <p style="margin:0;color:var(--muted);">${chosen.realInstitution}</p>
          <p style="margin:0.6rem 0 0;">${chosen.career} &middot; ${chosen.focus}</p>
          <div class="tags" style="margin-top:0.7rem;">
            ${chosen.tags.map((t) => `<span class="tag">${t}</span>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function updateRoleSummary() {
    const roleLabel = state.role === "mentor" ? "Mentor" : "Mentee";
    const el = $("#sumRole");
    if (el) el.textContent = roleLabel;
  }

  function reset() {
    state.role = null;
    state.picks = new Set();
    state.revealed = null;
    show(1);
  }

  // ----- Event wiring -----
  document.addEventListener("DOMContentLoaded", () => {
    // Role choice
    $$(".choice").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        state.role = el.dataset.role;
        state.picks = new Set();
        updateRoleSummary();
        show(2);
      });
    });

    // Navigation buttons with data-goto
    $$("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const target = Number(btn.dataset.goto);
        if (target === 3) renderMatches();
        if (target === 5) { renderPickList(); renderReveal(); }
        show(target);
      });
    });

    // Submit picks
    const submit = $("#submitPicks");
    if (submit) {
      submit.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (state.picks.size === 0) return;
        renderPickList();
        show(4);
      });
    }

    // Restart buttons
    const r1 = document.getElementById("restartBtn");
    const r2 = document.getElementById("restartBtn2");
    [r1, r2].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        reset();
      });
    });

    // Start at step 1
    show(1);
  });
})();
