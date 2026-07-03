/* ============================================
   ISEV–SNEV Mentorship Program · Application form
   - Reveals the rest of the form once a role is chosen
   - Shows mentor- or mentee-specific fields based on role
   - Builds two ranked career-topic pickers (primary + secondary for mentees;
     primary only for mentors)
   - Enforces cross-tier deduplication: a topic can appear in primary OR
     secondary, not both
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
  const MAX_TIER_PICKS = 5;

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

  // ----- Topic picker construction -----
  // We build two pickers that share the same 14-topic universe. Each has its
  // own 5-max cap; cross-tier dedup is enforced in the change handler.

  const topicPickers = [
    {
      tier: "primary",
      gridId: "topicsPrimaryGrid",
      countId: "topicsPrimaryCount",
      countLabel: "Primary"
    },
    {
      tier: "secondary",
      gridId: "topicsSecondaryGrid",
      countId: "topicsSecondaryCount",
      countLabel: "Secondary"
    }
  ];

  function buildPicker(picker) {
    const grid = document.getElementById(picker.gridId);
    if (!grid) return;
    grid.innerHTML = "";
    CAREER_TOPICS.forEach((topic) => {
      const row = document.createElement("div");
      row.className = "topic-row";
      row.dataset.topicId = topic.id;
      row.dataset.tier = picker.tier;

      const check = document.createElement("label");
      check.className = "topic-check";
      // Checkboxes carry a tier-prefixed name so FormData sees them as
      // distinct sets, even though we'll serialize them manually.
      check.innerHTML =
        '<input type="checkbox" name="topic_selected_' + picker.tier +
        '" value="' + topic.id + '" />' +
        '<span>' + topic.label + '</span>';

      const rank = document.createElement("select");
      rank.className = "topic-rank";
      rank.name = "topic_rank_" + picker.tier + "_" + topic.id;
      rank.disabled = true;
      rank.setAttribute(
        "aria-label",
        picker.countLabel + " priority for " + topic.label
      );
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "—";
      rank.appendChild(blank);
      for (let r = 1; r <= MAX_TIER_PICKS; r++) {
        const opt = document.createElement("option");
        opt.value = String(r);
        opt.textContent = String(r);
        rank.appendChild(opt);
      }

      row.appendChild(check);
      row.appendChild(rank);
      grid.appendChild(row);
    });

    grid.addEventListener("change", (ev) => onPickerChange(picker, ev));
  }

  function otherPicker(picker) {
    return topicPickers.find((p) => p.tier !== picker.tier);
  }

  function getGrid(tier) {
    const p = topicPickers.find((x) => x.tier === tier);
    return p ? document.getElementById(p.gridId) : null;
  }

  function rowForTopic(tier, topicId) {
    const grid = getGrid(tier);
    if (!grid) return null;
    return grid.querySelector(
      '.topic-row[data-topic-id="' + topicId + '"]'
    );
  }

  function currentlyRankedInTier(tier) {
    const grid = getGrid(tier);
    if (!grid) return [];
    return Array.from(grid.querySelectorAll(".topic-rank"))
      .filter((r) => !r.disabled && r.value)
      .map((r) => ({
        id: r.closest(".topic-row").dataset.topicId,
        rank: parseInt(r.value, 10)
      }));
  }

  function nextFreeRankInTier(tier) {
    const used = new Set(currentlyRankedInTier(tier).map((x) => x.rank));
    for (let r = 1; r <= MAX_TIER_PICKS; r++) if (!used.has(r)) return r;
    return null;
  }

  function deselectInTier(tier, topicId) {
    const row = rowForTopic(tier, topicId);
    if (!row) return false;
    const cb = row.querySelector('input[type="checkbox"]');
    const rank = row.querySelector(".topic-rank");
    if (cb && cb.checked) {
      cb.checked = false;
      if (rank) { rank.disabled = true; rank.value = ""; }
      return true;
    }
    return false;
  }

  function onPickerChange(picker, ev) {
    const t = ev.target;
    if (!t) return;

    if (t.matches('input[type="checkbox"][name^="topic_selected_"]')) {
      const row = t.closest(".topic-row");
      const topicId = row.dataset.topicId;
      const rank = row.querySelector(".topic-rank");

      if (t.checked) {
        // Cross-tier dedup: if already ranked in the other tier, pull it out.
        const other = otherPicker(picker);
        if (deselectInTier(other.tier, topicId)) {
          updateCount(other);
        }

        // Enforce this tier's cap.
        const grid = document.getElementById(picker.gridId);
        const selected = grid.querySelectorAll(
          'input[name="topic_selected_' + picker.tier + '"]:checked'
        );
        if (selected.length > MAX_TIER_PICKS) {
          t.checked = false;
          flashCount(picker);
          return;
        }

        rank.disabled = false;
        if (!rank.value) {
          const r = nextFreeRankInTier(picker.tier);
          if (r) rank.value = String(r);
        }
      } else {
        rank.disabled = true;
        rank.value = "";
      }
      updateCount(picker);
    } else if (t.matches(".topic-rank")) {
      const newVal = t.value;
      if (!newVal) return;
      // Prevent duplicate ranks within the same tier — swap with whoever
      // had that rank.
      const grid = document.getElementById(picker.gridId);
      const others = Array.from(grid.querySelectorAll(".topic-rank"))
        .filter((r) => r !== t && !r.disabled && r.value === newVal);
      if (others.length) {
        const free = nextFreeRankInTier(picker.tier);
        others.forEach((o) => { o.value = free ? String(free) : ""; });
      }
    }
  }

  function updateCount(picker) {
    const countEl = document.getElementById(picker.countId);
    if (!countEl) return;
    const grid = document.getElementById(picker.gridId);
    const n = grid.querySelectorAll(
      'input[name="topic_selected_' + picker.tier + '"]:checked'
    ).length;
    countEl.classList.remove("error");
    countEl.textContent = n + " of " + MAX_TIER_PICKS + " selected.";
  }

  function flashCount(picker) {
    const countEl = document.getElementById(picker.countId);
    if (!countEl) return;
    countEl.classList.add("error");
    countEl.textContent =
      "Pick up to " + MAX_TIER_PICKS + " " + picker.countLabel.toLowerCase() +
      " topics — deselect one first.";
    setTimeout(() => updateCount(picker), 1800);
  }

  topicPickers.forEach(buildPicker);

  // ----- Role handling -----
  function applyRole(role) {
    revealSections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    });

    // Show only the matching role-specific blocks; disable inputs elsewhere
    // so required-field validation doesn't trip on hidden controls.
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

    // Update the primary-tier help text with role-specific framing.
    const primaryHelp = document.getElementById("topicsPrimaryHelp");
    if (primaryHelp) {
      primaryHelp.innerHTML = role === "mentor"
        ? "Pick up to 5 topics you are <strong>most willing and able to " +
          "mentor on</strong> and rank them 1 (strongest) through 5."
        : "Pick up to 5 topics that are your <strong>top priorities</strong> " +
          "for mentorship and rank them 1 (most important) through 5.";
    }

    // Primary tier label wording
    const primaryLabel = document.getElementById("topicsPrimaryLabel");
    if (primaryLabel) {
      primaryLabel.textContent = role === "mentor"
        ? "Topics you can mentor on"
        : "Primary priorities";
    }

    const topicsIntro = document.getElementById("topicsIntro");
    if (topicsIntro) {
      topicsIntro.textContent = role === "mentor"
        ? "Tell us what you're best positioned to mentor on. Rank your top " +
          "5 — the matching algorithm uses these heavily."
        : "Rank the career topics you want to work on. You'll fill in your " +
          "primary priorities first, then optionally add a secondary list " +
          "weighted lower in matching.";
    }

    // Ensure a required field on the visible role-specific textarea
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
  function rankedTierPayload(tier) {
    return currentlyRankedInTier(tier)
      .filter((x) => Number.isFinite(x.rank) && x.rank > 0)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => ({ topic: x.id, rank: x.rank }));
  }

  function buildPayload() {
    const formData = new FormData(form);
    const payload = {};

    const multiValued = new Set(["languages", "focus_areas", "availability_window"]);

    formData.forEach((value, key) => {
      // Skip picker internals — we serialize those explicitly below.
      if (key.indexOf("topic_selected_") === 0) return;
      if (key.indexOf("topic_rank_primary_") === 0) return;
      if (key.indexOf("topic_rank_secondary_") === 0) return;

      if (multiValued.has(key)) {
        if (!Array.isArray(payload[key])) payload[key] = [];
        payload[key].push(value);
      } else if (payload[key] !== undefined) {
        payload[key] = [].concat(payload[key], value);
      } else {
        payload[key] = value;
      }
    });

    multiValued.forEach((k) => { if (!(k in payload)) payload[k] = []; });

    const role = payload.role;
    const primary = rankedTierPayload("primary");
    const secondary = role === "mentee" ? rankedTierPayload("secondary") : [];

    payload.career_topics_primary_ranked = primary;
    payload.career_topics_secondary_ranked = secondary;

    // Flat, Sheet-friendly strings
    payload.career_topics_primary_text = primary
      .map((t) => t.rank + ". " + t.topic).join(", ");
    payload.career_topics_secondary_text = secondary
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

    // Require at least one primary career topic
    const primaryCount = rankedTierPayload("primary").length;
    if (primaryCount < 1) {
      statusEl.classList.add("error");
      statusEl.textContent =
        "Please pick at least one primary career topic and set its priority.";
      const primaryBlock = document.getElementById("topicsPrimary");
      if (primaryBlock) primaryBlock.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const action = form.getAttribute("action") || "";
    if (action.includes("YOUR_FORM_ENDPOINT")) {
      statusEl.classList.add("error");
      statusEl.textContent =
        "This form is not configured yet. Replace YOUR_FORM_ENDPOINT in apply.html with your form service URL (see SETUP.md).";
      return;
    }

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
