// ---- API ----
const apiFetch = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const api = {
  getConfig: () => apiFetch("/api/config"),
  getRecords: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/records${qs ? "?" + qs : ""}`);
  },
  getRecord: (ref) => apiFetch(`/api/records/${encodeURIComponent(ref)}`),
  transact: (body) =>
    apiFetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

// ---- State ----
let activeType = null;
let activeKey = null;
let records = [];
let searchTimer = null;
let schema = null;
let activeFilters = {};

// Fields always shown in the header/readonly area
const SYSTEM_READONLY = new Set([
  "id",
  "uid",
  "key",
  "type",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
]);

// ---- Schema helpers ----
const loadSchema = async () => {
  schema = await apiFetch("/api/schema");
  return schema;
};

const getTypeKeys = () =>
  schema ? Object.keys(schema.types).sort() : [];

// TypeFieldRef is either a string key or [key, attrs]
const getTypeFields = (typeKey) => {
  const t = schema?.types?.[typeKey];
  if (!t) return [];
  return t.fields.map((ref) =>
    Array.isArray(ref)
      ? { key: ref[0], attrs: ref[1] ?? {} }
      : { key: ref, attrs: {} },
  );
};

const getFieldDef = (key) => schema?.fields?.[key];

// Apply per-type field attributes (only / exclude) to an option field's
// option list.
const getEffectiveOptions = (def, attrs) => {
  const options = def?.options ?? [];
  if (!options.length || !attrs) return options;
  let out = options;
  if (Array.isArray(attrs.only) && attrs.only.length) {
    const allowed = new Set(attrs.only);
    out = out.filter((o) => allowed.has(o.key));
  }
  if (Array.isArray(attrs.exclude) && attrs.exclude.length) {
    const denied = new Set(attrs.exclude);
    out = out.filter((o) => !denied.has(o.key));
  }
  return out;
};

const isMultiLine = (fieldDef) => {
  if (fieldDef?.dataType !== "richtext") return false;
  const f = fieldDef.richtextFormat;
  return f === "block" || f === "section" || f === "document";
};

// ---- Sidebar: types ----
const renderTypeList = (types) => {
  const el = document.getElementById("type-list");
  if (!types.length) {
    el.innerHTML = '<div class="loading">No types</div>';
    return;
  }
  el.innerHTML = types
    .map(
      (t) =>
        `<div class="type-item${t === activeType ? " active" : ""}" data-type="${esc(t)}">${esc(t)}</div>`,
    )
    .join("");
  el.querySelectorAll(".type-item").forEach((item) =>
    item.addEventListener("click", () => selectType(item.dataset.type)),
  );
};

// ---- Record list ----
// Filtering and search happen client-side against this cached list.
const fetchRecords = async (type) => {
  const data = await api.getRecords({ type, limit: "100" });
  return data.items;
};

// ---- Filter bar ----
const PILL_OPTION_THRESHOLD = 3; // show dropdown when option count exceeds this

const describeTypeFields = (typeKey) =>
  getTypeFields(typeKey).map((f) => ({
    key: f.key,
    attrs: f.attrs,
    def: getFieldDef(f.key),
  }));

const getOptionFieldsForType = (typeKey) =>
  describeTypeFields(typeKey).filter(
    ({ def }) => def && def.dataType === "option" && !def.allowMultiple,
  );

// Tag-like fields: multi-value plaintext with `identifier` format. They hold
// short slug values (e.g. tags) and are sensible to filter on. Freeform
// plaintext fields are excluded.
const getTagLikeFieldsForType = (typeKey) =>
  describeTypeFields(typeKey).filter(
    ({ def }) =>
      def &&
      def.dataType === "plaintext" &&
      def.allowMultiple &&
      def.plaintextFormat === "identifier",
  );

const collectDistinctValues = (items, fieldKey) => {
  const out = new Set();
  for (const item of items) {
    const v = item[fieldKey];
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => x != null && out.add(String(x)));
    else out.add(String(v));
  }
  return [...out].sort();
};

const renderOptionFilter = ({ key, attrs, def }) => {
  const selected = activeFilters[key] ?? "";
  const options = getEffectiveOptions(def, attrs);
  const label = `<span class="filter-label">${esc(def.name ?? key)}</span>`;

  if (options.length > PILL_OPTION_THRESHOLD) {
    const opts = [
      `<option value="">All</option>`,
      ...options.map(
        (o) =>
          `<option value="${esc(o.key)}"${selected === o.key ? " selected" : ""}>${esc(o.name ?? o.key)}</option>`,
      ),
    ].join("");
    return `
      <div class="filter-row">
        ${label}
        <select class="filter-select${selected ? " active" : ""}" data-field="${esc(key)}">${opts}</select>
      </div>`;
  }

  const pills = [
    `<span class="filter-pill${!selected ? " active" : ""}" data-field="${esc(key)}" data-value="">All</span>`,
    ...options.map(
      (o) =>
        `<span class="filter-pill${selected === o.key ? " active" : ""}" data-field="${esc(key)}" data-value="${esc(o.key)}">${esc(o.name ?? o.key)}</span>`,
    ),
  ].join("");
  return `
    <div class="filter-row">
      ${label}
      ${pills}
    </div>`;
};

const renderTagFilter = ({ key, def }) => {
  const selected = activeFilters[key] ?? "";
  const values = collectDistinctValues(records, key);
  if (!values.length && !selected) return "";
  const opts = [
    `<option value="">All</option>`,
    ...values.map(
      (v) =>
        `<option value="${esc(v)}"${selected === v ? " selected" : ""}>${esc(v)}</option>`,
    ),
  ].join("");
  return `
    <div class="filter-row">
      <span class="filter-label">${esc(def.name ?? key)}</span>
      <select class="filter-select${selected ? " active" : ""}" data-field="${esc(key)}">${opts}</select>
    </div>`;
};

const renderFilterBar = () => {
  const el = document.getElementById("filter-wrap");
  if (!activeType) {
    el.innerHTML = "";
    return;
  }
  const rows = [
    ...getOptionFieldsForType(activeType).map(renderOptionFilter),
    ...getTagLikeFieldsForType(activeType).map(renderTagFilter),
  ].filter(Boolean);
  el.innerHTML = rows.join("");

  el.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const field = pill.dataset.field;
      const value = pill.dataset.value || null;
      if (activeFilters[field] === value) return;
      activeFilters[field] = value;
      renderFilterBar();
      refreshList();
    });
  });

  el.querySelectorAll(".filter-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      activeFilters[sel.dataset.field] = sel.value || null;
      renderFilterBar();
      refreshList();
    });
  });
};

// ---- Client-side filtering ----
const recordMatchesFilters = (record) => {
  for (const [field, value] of Object.entries(activeFilters)) {
    if (!value) continue;
    const v = record[field];
    const matches = Array.isArray(v)
      ? v.map(String).includes(value)
      : String(v ?? "") === value;
    if (!matches) return false;
  }
  return true;
};

const recordMatchesSearch = (record, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    record.key?.toLowerCase().includes(q) ||
    record.title?.toLowerCase().includes(q)
  );
};

const refreshList = () => {
  const query = document.getElementById("search").value;
  const filtered = records.filter(
    (r) => recordMatchesFilters(r) && recordMatchesSearch(r, query),
  );
  renderRecordList(filtered);
};

const renderRecordList = (items) => {
  const el = document.getElementById("record-list");
  if (!items.length) {
    el.innerHTML = '<div class="loading">No records</div>';
    return;
  }
  el.innerHTML = items
    .map(
      (r) =>
        `<div class="record-item${r.key === activeKey ? " active" : ""}" data-key="${esc(r.key)}">
  <div class="record-key">${esc(r.key)}</div>
  <div class="record-title">${esc(r.title ?? r.key)}</div>
</div>`,
    )
    .join("");
  el.querySelectorAll(".record-item").forEach((item) =>
    item.addEventListener("click", () => selectRecord(item.dataset.key)),
  );
};

// ---- Detail ----
const renderDetail = (record) => {
  const dc = document.getElementById("detail-content");
  document.getElementById("detail-empty").style.display = "none";
  dc.style.display = "block";

  const typeFields = getTypeFields(record.type);
  const typeFieldAttrs = new Map(typeFields.map((f) => [f.key, f.attrs]));

  // Ordered field list from the type definition. Title is rendered in the
  // header; system identity fields are read-only and shown elsewhere.
  const ordered = typeFields
    .map((f) => f.key)
    .filter((k) => k !== "title" && !SYSTEM_READONLY.has(k));

  // Append any extra keys present on the record but not in the type
  // definition (e.g. legacy data) so nothing is silently hidden.
  for (const k of Object.keys(record)) {
    if (SYSTEM_READONLY.has(k)) continue;
    if (k === "title") continue;
    if (!ordered.includes(k)) ordered.push(k);
  }

  const systemLine = [
    record.type,
    record.key,
    record.uid ? `uid: ${record.uid}` : null,
  ]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  dc.innerHTML = `
<div id="detail-key">${systemLine}</div>
<div id="detail-title">${esc(record.title ?? record.key ?? "")}</div>
${ordered
  .map((k) => {
    const def = getFieldDef(k);
    const attrs = typeFieldAttrs.get(k);
    const label = def?.name ?? k;
    return `
  <div class="field-row">
    <div class="field-name">${esc(label)}</div>
    <div class="field-value">${renderField(k, record[k], def, attrs)}</div>
  </div>`;
  })
  .join("")}
<div style="margin-top:16px">
  <button class="save-btn" id="save-btn" disabled>Save</button>
  <span class="save-status" id="save-status"></span>
</div>
`;

  dc.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("input", () => {
      document.getElementById("save-btn").disabled = false;
      document.getElementById("save-status").textContent = "";
    });
  });

  // Auto-expand textareas to content height (capped by CSS max-height).
  dc.querySelectorAll("textarea").forEach((ta) => {
    const autosize = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    };
    ta.addEventListener("input", autosize);
    // Defer initial sizing until the element is in layout.
    requestAnimationFrame(autosize);
  });

  dc.querySelectorAll("a.link[data-ref]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openByRef(el.dataset.ref);
    });
  });

  document
    .getElementById("save-btn")
    .addEventListener("click", () => saveRecord(record.key));
};

const INPUT_TYPE_BY_DATA_TYPE = { date: "date", uri: "url" };

const renderField = (key, value, def, attrs) => {
  if (value === null || value === undefined || value === "")
    return `<span class="readonly">—</span>`;

  const dataType = def?.dataType;

  // Relations → clickable links to the related record(s).
  if (dataType === "relation") {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((v) => {
        const ref = typeof v === "string" ? v : (v?.key ?? v?.uid ?? "");
        return `<a class="link" data-ref="${esc(ref)}" href="/records/${esc(encodeURIComponent(ref))}">${esc(ref)}</a>`;
      })
      .join("");
  }

  // Options → read-only pill, using the option's display name when available.
  if (dataType === "option") {
    const values = Array.isArray(value) ? value : [value];
    const effective = getEffectiveOptions(def, attrs);
    return values
      .map((v) => {
        const opt = effective.find((o) => o.key === v);
        return `<span class="pill">${esc(opt?.name ?? v)}</span>`;
      })
      .join("");
  }

  // Multi-line richtext → textarea(s).
  if (isMultiLine(def)) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map(
        (v, i) => `
            <div class="multi-item">
              <textarea data-field="${esc(key)}" data-index="${i}" rows="4">${esc(String(v))}</textarea>
            </div>`,
      )
      .join("");
  }

  // Multi-value primitive → tags (read-only for now).
  if (Array.isArray(value))
    return value
      .map((v) => `<span class="tag">${esc(String(v))}</span>`)
      .join("");

  if (typeof value === "string") {
    const inputType = INPUT_TYPE_BY_DATA_TYPE[dataType] ?? "text";
    return `<input type="${inputType}" data-field="${esc(key)}" value="${esc(value)}" />`;
  }

  return `<span class="readonly">${esc(String(value))}</span>`;
};

const saveRecord = async (key) => {
  const btn = document.getElementById("save-btn");
  const status = document.getElementById("save-status");
  btn.disabled = true;
  status.textContent = "Saving…";
  status.style.color = "var(--muted)";

  const updates = { key };
  const multi = {}; // field -> [values by index]
  document.querySelectorAll("[data-field]").forEach((el) => {
    const f = el.dataset.field;
    if (el.dataset.index !== undefined) {
      const arr = (multi[f] = multi[f] || []);
      arr[parseInt(el.dataset.index, 10)] = el.value;
    } else {
      updates[f] = el.value;
    }
  });
  for (const [f, arr] of Object.entries(multi)) {
    updates[f] = arr.filter((v) => v !== undefined);
  }

  try {
    await api.transact({ records: [updates] });
    status.textContent = "Saved";
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  } catch (e) {
    status.style.color = "var(--error)";
    status.textContent = e.message;
    btn.disabled = false;
  }
};

// ---- URL routing ----
const getRefFromUrl = () => {
  const m = location.pathname.match(/^\/records\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

const pushUrl = (key) => {
  const url = "/records/" + encodeURIComponent(key);
  if (location.pathname !== url) history.pushState({ key }, "", url);
};

const openByRef = async (ref) => {
  let record;
  try {
    record = await api.getRecord(ref);
  } catch {
    document.getElementById("detail-empty").textContent =
      "Record not found: " + ref;
    return;
  }
  pushUrl(record.key ?? ref);
  const type = record.type;
  if (type && type !== activeType) {
    activeType = type;
    activeFilters = {};
    renderTypeList(getTypeKeys());
    records = await fetchRecords(type);
    renderFilterBar();
  }
  activeKey = record.key ?? ref;
  refreshList();
  renderDetail(record);
};

window.addEventListener("popstate", () => {
  const ref = getRefFromUrl();
  if (ref) openByRef(ref);
});

// ---- Actions ----
const selectType = async (type) => {
  activeType = type;
  activeKey = null;
  activeFilters = {};
  renderTypeList(getTypeKeys());
  document.getElementById("record-list").innerHTML =
    '<div class="loading">Loading…</div>';
  document.getElementById("detail-empty").style.display = "block";
  document.getElementById("detail-content").style.display = "none";
  records = await fetchRecords(type);
  renderFilterBar(); // depends on loaded records for tag values
  refreshList();
};

const selectRecord = async (key) => {
  activeKey = key;
  pushUrl(key);
  renderRecordList(records);
  const record = await api.getRecord(key);
  renderDetail(record);
};

// ---- Search ----
document.getElementById("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (!activeType) return;
    refreshList();
  }, 150);
});

// ---- Helpers ----
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---- Init ----
(async () => {
  try {
    await loadSchema();
    const types = getTypeKeys();
    renderTypeList(types);
    const initRef = getRefFromUrl();
    if (initRef) await openByRef(initRef);
    else if (types.length) await selectType(types[0]);
  } catch (e) {
    document.getElementById("type-list").innerHTML =
      `<div class="error-msg">${e.message}</div>`;
  }
})();
