/* ============================================
   ISEV–SNEV Mentorship Program · Application form
   - Reveals the rest of the form once a role is chosen
   - Shows mentor- or mentee-specific fields based on role
   - Builds the ranked career-topics picker from a canonical list
   - Serializes multi-selects and ranked topics into a clean JSON payload
   - Posts to a configured form-handling endpoint (AJAX); falls back to a
     standard form POST if fetch() fails or the endpoint isn't JSON-capable
   ============================================ */

(function () {
  "use strict";

  // Canonical career-topic list (must match ARCHITECTURE.md §3.1).
  // Keep order stable — both sides see the same list in the same order.
  const CAREER_TOPICS = [
    { id: "career_transition", label: "Career transitions (e.g., postdoc to PI, academia to industry)" },
    { id: "industry_advancement", label: "Industry career advancement" },
    { id: "academic_career", label: "Academic career development" },
    { id: "grant_writing", label: "Grant and fellowship writing" },
    { id: "networking", label: "Networking in the EV community" },
    { id: "job_search", label: "Job search and interviewing" },
    { id: "communication", label: "Scientific communication and presentation" },
    { id: "leadership", label: "Leadership and management" },
    { id: "long_term_trajectory", label: "Long-term career trajectory" },
    { id: "work_life", label: "Work–life balance and sustainability" },
    { id: "dei", label: "Diversity, equity and inclusion" },
    { id: "publishing", label: "Publishing strategy" },
    { id: "mentoring_others", label: "Mentoring others" },
    { id: "international_moves", label: "International moves and relocation" }
  ];
  const MAX_TOPIC_PICKS = 5;

  const form = document.getElementById("applyForm");
  if (!form) return;

  const roleInputs = form.querySelectorAll('input[name="role"]');
  const roleChoices = form.querySelectorAll(".role-choice");
  const revealSections = [
    "aboutYou",
    "research",
    "topics",
    "availability",
    "consent",
    "formActions"
  ];
  const roleSpecific = form.querySelectorAll(".role-specific");
  const subjectInput = document.getElementById("formSubject");
  const statusEl = document.getElementById("formStatus");
  const successPanel = document.getElementById("submitSuccess");

  // ----- Build the ranked-topics picker -----
  const topicsGrid = document.getElementById("topicsGrid");
  const topicsCountEl = document.getElementById("topicsCount");

  function buildTopicsPicker() {
    if (!topicsGrid) return;
    topicsGrid.innerHTML = "";
    CAREER_TOPICS.forEach((topic) => {
      const row = document.createElement("div");
      row.className = "topic-row";
      row.dataset.topicId = topic.id;

      const check = document.createElement("label");
      check.className = "topic-check";
      check.innerHTML =
        '<input type="checkbox" name="topic_selected" value="' + topic.id + '" />' +
        '<span>' + topic.label + '</span>';

      const rank = document.createElement("select");
      rank.className = "topic-rank";
      rank.name = "topic_rank_" + topic.id;
      rank.disabled = true;
      rank.setAttribute("aria-label", "Priority for " + topic.label);
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "—";
      rank.appendChild(blank);
      for (let r = 1; r <= MAX_TOPIC_PICKS; r++) {
        const opt = document.createElement("option");
        opt.value = String(r);
        opt.textContent = String(r);
        rank.appendChild(opt);
      }

      row.appendChild(check);
      row.appendChild(rank);
      topicsGrid.appendChild(row);
    });

    // Wire checkbox -> enable rank + enforce cap + auto-assign next free rank
    topicsGrid.addEventListener("change", onTopicsChange);
  }

  function currentlyRankedIds() {
    return Array.from(topicsGrid.querySelectorAll(".topic-rank"))
      .filter((r) => !r.disabled && r.value)
      .map((r) => ({
        id: r.closest(".topic-row").dataset.topicId,
        rank: parseInt(r.value, 10)
      }));
  }

  function nextFreeRank() {
    const used = new Set(
      currentlyRankedIds().map((x) => x.rank)
    );
    for (let r = 1; r <= MAX_TOPIC_PICKS; r++) if (!used.has(r)) return r;
    return null;
  }

  function onTopicsChange(ev) {
    const t = ev.target;
    if (!t) return;

    if (t.matches('input[type="checkbox"][name="topic_selected"]')) {
      const row = t.closest(".topic-row");
      const rank = row.querySelector(".topic-rank");
      if (t.checked) {
        // Enforce cap
        const selected = topicsGrid.querySelectorAll(
          'input[name="topic_selected"]:checked'
        );
        if (selected.length > MAX_TOPIC_PICKS) {
          t.checked = false;
          flashCount();
          return;
        }
        rank.disabled = false;
        if (!rank.value) {
          const r = nextFreeRank();
          if (r) rank.value = String(r);
        }
      } else {
        rank.disabled = true;
        rank.value = "";
      }
      updateTopicsCount();
    } else if (t.matches(".topic-rank")) {
      // Prevent duplicate ranks — swap with whoever had it
      const newVal = t.value;
      if (!newVal) return;
      const others = Array.from(topicsGrid.querySelectorAll(".topic-rank"))
        .filter((r) => r !== t && !r.disabled && r.value === newVal);
      if (others.length) {
        // Put the free rank into the other
        const free = nextFreeRank();
        others.forEach((o) => { o.value = free ? String(free) : ""; });
      }
    }
  }

  function updateTopicsCount() {
    if (!topicsCountEl) return;
    const n = topicsGrid.querySelectorAll(
      'input[name="topic_selected"]:checked'
    ).length;
    topicsCountEl.textContent = n + " of " + MAX_TOPIC_PICKS + " selected.";
  }

  function flashCount() {
    if (!topicsCountEl) return;
    topicsCountEl.classList.add("error");
    topicsCountEl.textContent =
      "Pick up to " + MAX_TOPIC_PICKS + " topics — deselect one first.";
    setTimeout(() => {
      topicsCountEl.classList.remove("error");
      updateTopicsCount();
    }, 1800);
  }

  buildTopicsPicker();

  // ----- Role handling -----
  function applyRole(role) {
    // Reveal shared sections and the submit row
    revealSections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    });

    // Show only the matching role-specific fieldset; disable inputs in the other
    roleSpecific.forEach((fs) => {
      const match = fs.dataset.role === role;
      fs.hidden = !match;
      fs.querySelectorAll("input, select, textarea").forEach((el) => {
        if (match) {
          if (el.dataset.origRequired === "true") el.required = true;
          el.disabled = false;
        } else {
          if (el.required) el.dataset.origRequired = "true";
          el.required = false;
          el.disabled = true;
        }
      });
    });

    // Ensure the primary textarea in the visible role block is required
    const visibleRoleFs = role === "mentor"
      ? document.getElementById("mentorFields")
      : document.getElementById("menteeFields");
    if (visibleRoleFs) {
      const primaryTextarea = visibleRoleFs.querySelector("textarea");
      if (primaryTextarea) primaryTextarea.required = true;
    }

    // Highlight the selected role card
    roleChoices.forEach((lbl) => {
      const input = lbl.querySelector('input[type="radio"]');
      lbl.classList.toggle("selected", input && input.checked);
    });

    // Update the email subject line
    if (subjectInput) {
      subjectInput.value =
        "ISEV-SNEV Mentorship Application (" +
        (role === "mentor" ? "mentor" : "mentee") + ")";
    }
  }

  roleInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) applyRole(input.value);
    });
  });

  // ----- Serialization -----
  function buildPayload() {
    // Standard FormData first
    const formData = new FormData(form);
    const payload = {};

    // Keys that must always be arrays (multi-selects)
    const multiValued = new Set(["languages", "focus_areas", "availability_window"]);

    formData.forEach((value, key) => {
      if (key === "topic_selected") return;          // handled separately
      if (key.indexOf("topic_rank_") === 0) return;  // handled separately
      if (multiValued.has(key)) {
        if (!Array.isArray(payload[key])) payload[key] = [];
        payload[key].push(value);
      } else if (payload[key] !== undefined) {
        payload[key] = [].concat(payload[key], value);
      } else {
        payload[key] = value;
      }
    });

    // Ensure multi-select keys exist even if nothing was chosen
    multiValued.forEach((k) => { if (!(k in payload)) payload[k] = []; });

    // Ranked topics -> array of {topic, rank}, sorted by rank ascending
    const topics = currentlyRankedIds()
      .filter((x) => Number.isFinite(x.rank) && x.rank > 0)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => ({ topic: x.id, rank: x.rank }));
    payload.career_topics_ranked = topics;
    // Also include a flat comma-separated string for Sheet-style backends
    payload.career_topics_ranked_text = topics
      .map((t) => t.rank + ". " + t.topic).join(", ");

    return payload;
  }

  // ----- Submission -----
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    statusEl.className = "form-status";
    statusEl.textContent = "";

    // Honeypot check
    const hp = form.querySelector('input[name="_gotcha"]');
    if (hp && hp.value) {
      // Pretend it worked; spam gets silently dropped
      showSuccess();
      return;
    }

    // HTML5 validation
    if (!form.checkValidity()) {
      statusEl.classList.add("error");
      statusEl.textContent = "Please fill in the required fields highlighted above.";
      const firstInvalid = Array.from(form.elements).find(
        (el) => !el.disabled && el.willValidate && !el.checkValidity()
      );
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    // Require at least one ranked career topic
    const topicCount = topicsGrid
      ? topicsGrid.querySelectorAll('input[name="topic_selected"]:checked').length
      : 0;
    if (topicCount < 1) {
      statusEl.classList.add("error");
      statusEl.textContent =
        "Please pick at least one career topic and set its priority.";
      if (topicsGrid) topicsGrid.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const action = form.getAttribute("action") || "";
    if (action.includes("YOUR_FORM_ENDPOINT")) {
      statusEl.classList.add("error");
      statusEl.textContent =
        "This form is not configured yet. Replace YOUR_FORM_ENDPOINT in apply.html with your form service URL (see SETUP.md).";
      return;
    }

    // AJAX submit (JSON) — works with Apps Script, Cloudflare Workers,
    // Formspree, Basin, Getform, and most form handlers that accept JSON.
    try {
      statusEl.textContent = "Submitting…";
      const payload = buildPayload();

      const res = await fetch(action, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showSuccess();
      } else {
        let msg = "Submission failed. Please try again in a moment.";
        try {
          const data = await res.json();
          if (data && data.errors && data.errors.length) {
            msg = data.errors.map((e) => e.message || e).join("; ");
          } else if (data && data.error) {
            msg = data.error;
          }
        } catch (_) { /* ignore */ }
        statusEl.classList.add("error");
        statusEl.textContent = msg;
      }
    } catch (err) {
      // Network / CORS failure — fall back to a standard form post so the user's
      // application isn't lost.
      statusEl.textContent = "Retrying…";
      form.removeAttribute("novalidate");
      form.submit();
    }
  });

  function showSuccess() {
    form.hidden = true;
    if (successPanel) {
      successPanel.hidden = false;
      successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      statusEl.classList.add("success");
      statusEl.textContent = "Application received. Thank you.";
    }
  }
})();
