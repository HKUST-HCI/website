let batch;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[char]));
const safeLink = (value) => /^https?:\/\//i.test(String(value ?? "")) ? String(value) : "";

function renderNews() {
  const eligible = batch.news.filter((item) => item.memberMatchStatus === "accepted").length;
  const blocked = batch.news.filter((item) => item.memberMatchStatus === "not_found").length;
  $("#news-count").textContent = `${eligible} eligible · ${blocked} blocked`;
  $("#news-list").innerHTML = batch.news.map((item, index) => {
    const accepted = item.memberMatchStatus === "accepted";
    const disabled = item.systemNotice || !accepted;
    const members = (item.matchedMembers || []).join(", ");
    const evidence = (item.matchEvidence || []).join(", ");
    const badge = item.systemNotice
      ? "Automatic de-duplication notice"
      : accepted
        ? `People match: ${members} · evidence: ${evidence}`
        : "Blocked: no People current-member reference";
    return `<article class="item ${accepted ? "" : "item-blocked"}">
      <span class="meta">${escapeHtml(item.time)} · ${escapeHtml(item.sourceUrl)}</span>
      <span class="badge ${accepted ? "accepted" : "blocked"}">${escapeHtml(badge)}</span>
      <label>News text<textarea data-type="news" data-index="${index}" data-field="content">${escapeHtml(item.content)}</textarea></label>
      <label class="check"><input type="checkbox" data-type="news" data-index="${index}" data-field="approved" ${disabled ? "disabled" : ""}> ${accepted ? "Approve this matched News item" : "Cannot approve"}</label>
    </article>`;
  }).join("");
}

function renderPublications() {
  const incompleteVenues = batch.publications.filter((item) => item.venueStatus === "incomplete" || !item.venue).length;
  $("#publication-count").textContent = `${batch.publications.length} staged · ${incompleteVenues} venue fields need review`;
  $("#publication-list").innerHTML = batch.publications.map((item, index) => {
    const accepted = item.authorMatchStatus === "accepted" || item.firstAuthorStatus === "accepted";
    const venueIncomplete = item.venueStatus === "incomplete" || !item.venue;
    const sourceUrl = safeLink(item.scholarUrl || item.sourceUrl);
    const venueUrl = safeLink(item.publicationUrl || item.url);
    const sourceLink = sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Source (Google Scholar) ↗</a>`
      : '<span>Source unavailable</span>';
    const venueLink = venueUrl
      ? `<a href="${escapeHtml(venueUrl)}" target="_blank" rel="noopener noreferrer">DOI / Venue ↗</a>`
      : '<span class="link-missing">DOI / Venue unavailable</span>';
    return `<article class="item">
      <div class="publication-links meta">
        <span>${escapeHtml(item.year)}</span>
        ${sourceLink}
        ${venueLink}
      </div>
      <span class="badge ${accepted ? "accepted" : "blocked"}">${accepted ? `Current-member first author: ${escapeHtml(item.memberName)}` : `Blocked: ${escapeHtml(item.authorMatchStatus || item.firstAuthorStatus)}`}</span>
      ${venueIncomplete ? '<span class="badge blocked">Venue incomplete: edit this field before approval</span>' : ''}
      ${item.enrichmentStatus ? `<span class="badge ${item.enrichmentStatus === "complete" ? "accepted" : "blocked"}">Detail lookup: ${escapeHtml(item.enrichmentStatus)}</span>` : ''}
      <label>Title<textarea data-type="publications" data-index="${index}" data-field="title">${escapeHtml(item.title)}</textarea></label>
      <div class="item-grid">
        <label>First-author line<input data-type="publications" data-index="${index}" data-field="authorLine" value="${escapeHtml(item.authorLine)}"></label>
        <label>Venue<input data-type="publications" data-index="${index}" data-field="venue" value="${escapeHtml(item.venue)}"></label>
      </div>
      <label class="check"><input type="checkbox" data-type="publications" data-index="${index}" data-field="approved" ${accepted ? "" : "disabled"}> Approve this publication</label>
    </article>`;
  }).join("");
}

function collect() {
  document.querySelectorAll("[data-type][data-field]").forEach((input) => {
    const list = batch[input.dataset.type];
    const item = list[Number(input.dataset.index)];
    if (!item) return;
    if (input.dataset.field === "approved") item.decision = input.checked ? "approved" : "pending";
    else item[input.dataset.field] = input.value;
  });
  return batch;
}

function setAllApprovals(checked) {
  document.querySelectorAll("[data-type][data-field='approved']").forEach((input) => {
    if (input.disabled) return;
    input.checked = checked;
    const list = batch[input.dataset.type];
    const item = list?.[Number(input.dataset.index)];
    if (item) item.decision = checked ? "approved" : "pending";
  });
}

function approveAllVisible() {
  const reviewerName = $("#reviewer-name").value.trim();
  const reviewDate = $("#review-date").value;
  if (!reviewerName || !reviewDate) {
    $("#status").textContent = "Please fill reviewer name and review date before approving all eligible items.";
    $("#status").classList.add("error");
    return;
  }
  setAllApprovals(true);
  $("#confirmed").checked = true;
  $("#review-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function load() {
  const response = await fetch("/api/review");
  batch = await response.json();
  if (batch.error) {
    $("#status").textContent = batch.error;
    $("#status").classList.add("error");
    $("#review-form").hidden = true;
    return;
  }
  const scholarStats = batch.scholarStats || {};
  const newsStats = batch.newsStats || {};
  const mode = batch.mode === "news-revalidation"
    ? "News history revalidation"
    : batch.mode === "publication-enrichment"
      ? "Publication detail enrichment"
      : "Monthly scan";
  $("#status").textContent = `${mode} · batch ${batch.batchId} · ${batch.currentMemberCount} People current members · ${newsStats.matchedCurrentMembers || 0} News matched / ${newsStats.blockedNoCurrentMember || 0} blocked · Scholar ${scholarStats.matchedCurrentMemberFirstAuthors || 0} matched`;
  renderNews();
  renderPublications();
  $("#review-date").value = new Date().toISOString().slice(0, 10);
  if (batch.reviewStatus === "rejected") {
    const reason = batch.rejection?.reason || "No reason recorded";
    $("#status").textContent = `Rejected by ${batch.rejection?.reviewer || "reviewer"}: ${reason}. Resolve the issue and generate a new Review batch.`;
    $("#status").classList.add("error");
    $("#approve-all-btn").disabled = true;
    $("#reject-btn").disabled = true;
    $("#review-form").querySelector('button[type="submit"]').disabled = true;
  }
}

$("#approve-all-btn").addEventListener("click", approveAllVisible);

$("#reject-btn").addEventListener("click", async () => {
  const reviewerName = $("#reviewer-name").value.trim();
  const reviewDate = $("#review-date").value;
  const reason = $("#reject-reason").value.trim();
  if (!reviewerName || !reviewDate || !reason) {
    $("#status").textContent = "Reviewer name, review date, and a rejection reason are required.";
    $("#status").classList.add("error");
    return;
  }
  if (!window.confirm(`Reject this update?\n\nReason: ${reason}\n\nNo website content will be changed.`)) return;
  const rejectButton = $("#reject-btn");
  rejectButton.disabled = true;
  try {
    const response = await fetch("/api/reject", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ batchId: batch.batchId, reviewerName, reviewDate, reason })
    });
    const result = await response.json();
    $("#status").textContent = result.message;
    $("#status").classList.toggle("error", !result.ok);
    if (result.ok) window.location.reload();
  } finally {
    rejectButton.disabled = false;
  }
});

$("#review-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const payload = collect();
  payload.publications = payload.publications.filter((item) => item.decision === "approved");
  payload.reviewerName = $("#reviewer-name").value.trim();
  payload.reviewDate = $("#review-date").value;
  payload.confirmed = $("#confirmed").checked;
  const newsCount = payload.news.filter((item) => item.decision === "approved").length;
  const publicationCount = payload.publications.length;
  if (!window.confirm(`Confirm approval of ${newsCount} News item(s) and ${publicationCount} Publication(s)? This will update the corresponding preview pages.`)) return;
  submitButton.disabled = true;
  submitButton.textContent = "Writing update…";
  try {
    const response = await fetch("/api/approve", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload) });
    const result = await response.json();
    $("#status").textContent = result.message;
    $("#status").classList.toggle("error", !result.ok);
    if (result.ok) {
      const publicationsOnly = batch.mode === "publication-enrichment";
      window.alert(`${result.message}\n\nOpening the refreshed ${publicationsOnly ? "Publications" : "News"} preview.`);
      window.location.replace(publicationsOnly
        ? `/publications.html?updated=${Date.now()}`
        : `/index.html?updated=${Date.now()}#recent-news`);
      return;
    }
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Approve and write update";
  }
});

load().catch((error) => {
  $("#status").textContent = `Unable to load review batch: ${error.message}`;
  $("#status").classList.add("error");
});
