import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clock3,
  CopyPlus,
  Edit3,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

const MAX_ITEMS = 50;
const EMPTY_ITEM = {
  description: "",
  estimate: "",
  metric: "hours",
  confidence: 50,
  committed: false
};

function guid() {
  return crypto.randomUUID();
}

function getRouteId() {
  const id = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  return id || "";
}

function setRouteId(id, replace = false) {
  const url = `/${id}`;
  if (replace) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }
}

function hoursFor(item) {
  const value = Number(item.estimate) || 0;
  if (item.metric === "days") return value * 8;
  if (item.metric === "weeks") return value * 40;
  return value;
}

function rangeFor(item) {
  const hours = hoursFor(item);
  const uncertainty = (100 - Number(item.confidence || 0)) / 100;
  return {
    low: Math.max(0, hours * (1 - uncertainty)),
    high: hours * (1 + uncertainty)
  };
}

function formatHours(value) {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 1
  })}h`;
}

function createItem(overrides = {}) {
  return {
    id: guid(),
    ...EMPTY_ITEM,
    ...overrides
  };
}

function App() {
  const [estimateId, setEstimateId] = useState("");
  const [items, setItems] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let id = getRouteId();
    if (!id) {
      id = guid();
      setRouteId(id, true);
    }
    setEstimateId(id);

    fetch(`/api/estimates/${id}`)
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Unable to load this estimate.");
        return response.json();
      })
      .then((estimate) => {
        if (estimate) {
          setItems(estimate.items.map((item) => ({ ...item, committed: true })));
          setReadOnly(true);
        }
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const ranges = items.map(rangeFor);
    const totalLow = ranges.reduce((sum, item) => sum + item.low, 0);
    const totalHigh = ranges.reduce((sum, item) => sum + item.high, 0);
    const averageConfidence =
      items.length === 0
        ? 0
        : items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / items.length;

    return { totalLow, totalHigh, averageConfidence };
  }, [items]);

  function updateItem(id, patch) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch, committed: false } : item))
    );
  }

  function addItem() {
    if (items.length >= MAX_ITEMS) return;
    setItems((current) => [...current, createItem()]);
  }

  function removeItem(id) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function commitItem(id) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, committed: true } : item))
    );
  }

  function cancelItem(id) {
    setItems((current) =>
      current
        .map((item) => (item.id === id && !item.description ? null : item))
        .filter(Boolean)
    );
  }

  async function saveEstimate() {
    setMessage("");
    const invalid = items.find(
      (item) => !item.description.trim() || Number(item.estimate) < 0 || item.estimate === ""
    );

    if (items.length === 0) {
      setMessage("Add at least one line item before saving.");
      return;
    }
    if (invalid) {
      setMessage("Complete each line item before saving the estimate.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: estimateId,
          items: items.map(({ committed, ...item }) => item)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save estimate.");

      setItems(payload.items.map((item) => ({ ...item, committed: true })));
      setReadOnly(true);
      setMessage("Estimate saved as immutable JSON.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  function forkEstimate() {
    const nextId = guid();
    setEstimateId(nextId);
    setRouteId(nextId);
    setItems(items.map((item) => ({ ...item, id: guid(), committed: true })));
    setReadOnly(false);
    setMessage("Forked into a new editable estimate.");
  }

  if (loading) {
    return (
      <main className="shell">
        <div className="loading">Loading estimate...</div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Project estimate</p>
          <h1>{readOnly ? "My Estimate" : "Draft Estimate"}</h1>
          <p className="guid">{estimateId}</p>
        </div>
        <div className="actions">
          {readOnly ? (
            <button className="primary" onClick={forkEstimate}>
              <Edit3 size={18} aria-hidden="true" />
              Edit
            </button>
          ) : (
            <button className="primary" onClick={saveEstimate} disabled={saving}>
              <Save size={18} aria-hidden="true" />
              {saving ? "Saving" : "Save"}
            </button>
          )}
        </div>
      </header>

      <section className="summary" aria-label="Estimate summary">
        <div>
          <span>Low hours</span>
          <strong>{formatHours(totals.totalLow)}</strong>
        </div>
        <div>
          <span>High hours</span>
          <strong>{formatHours(totals.totalHigh)}</strong>
        </div>
        <div>
          <span>Average confidence</span>
          <strong>{Math.round(totals.averageConfidence)}%</strong>
        </div>
        <div>
          <span>Line items</span>
          <strong>
            {items.length}/{MAX_ITEMS}
          </strong>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      {items.length === 0 ? (
        <section className="empty">
          <Clock3 size={42} aria-hidden="true" />
          <h2>Start with a line item</h2>
          <p>Add scoped work, an estimate, a time metric, and confidence. Totals update as you go.</p>
          <button className="primary" onClick={addItem} disabled={readOnly}>
            <Plus size={18} aria-hidden="true" />
            Add item
          </button>
        </section>
      ) : (
        <section className="estimate-table" aria-label="Line items">
          <div className="table-head">
            <span>Description</span>
            <span>Estimate</span>
            <span>Metric</span>
            <span>Confidence</span>
            <span>Low</span>
            <span>High</span>
            <span></span>
          </div>
          {items.map((item) => (
            <LineItem
              key={item.id}
              item={item}
              readOnly={readOnly}
              onChange={(patch) => updateItem(item.id, patch)}
              onCommit={() => commitItem(item.id)}
              onCancel={() => cancelItem(item.id)}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </section>
      )}

      {!readOnly && items.length > 0 ? (
        <div className="footer-actions">
          <button className="secondary" onClick={addItem} disabled={items.length >= MAX_ITEMS}>
            <Plus size={18} aria-hidden="true" />
            Add item
          </button>
          <button className="primary" onClick={saveEstimate} disabled={saving}>
            <Save size={18} aria-hidden="true" />
            {saving ? "Saving" : "Save estimate"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

function LineItem({ item, readOnly, onChange, onCommit, onCancel, onRemove }) {
  const range = rangeFor(item);
  const canCommit = item.description.trim() && item.estimate !== "" && Number(item.estimate) >= 0;

  return (
    <div className="line-item">
      <input
        aria-label="Work item description"
        value={item.description}
        placeholder="Work item description"
        disabled={readOnly}
        onChange={(event) => onChange({ description: event.target.value })}
      />
      <input
        aria-label="Numerical estimate"
        type="number"
        min="0"
        step="0.25"
        value={item.estimate}
        disabled={readOnly}
        onChange={(event) => onChange({ estimate: event.target.value })}
      />
      <select
        aria-label="Time metric"
        value={item.metric}
        disabled={readOnly}
        onChange={(event) => onChange({ metric: event.target.value })}
      >
        <option value="hours">Hours</option>
        <option value="days">Days</option>
        <option value="weeks">Weeks</option>
      </select>
      <label className="confidence">
        <input
          aria-label="Confidence percentage"
          type="range"
          min="0"
          max="100"
          value={item.confidence}
          disabled={readOnly}
          onChange={(event) => onChange({ confidence: Number(event.target.value) })}
        />
        <span>{item.confidence}%</span>
      </label>
      <output>{formatHours(range.low)}</output>
      <output>{formatHours(range.high)}</output>
      <div className="row-actions">
        {readOnly ? null : (
          <>
            <button
              className="icon-button"
              aria-label="Save line item"
              title="Save line item"
              onClick={onCommit}
              disabled={!canCommit}
            >
              <Check size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              aria-label="Cancel line item"
              title="Cancel line item"
              onClick={onCancel}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button danger"
              aria-label="Remove line item"
              title="Remove line item"
              onClick={onRemove}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </>
        )}
        {readOnly ? <CopyPlus size={18} aria-label="Saved line item" /> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
