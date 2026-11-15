/** Data provenance row: source name / identifier and available lineage (handoff §4.11). */
function ProvenanceRow({ label, value, detail = null }) {
  return (
    <div className="mw-provenance-row">
      <dt>{label}</dt>
      <dd>
        <span className={value == null ? "mw-provenance-row__missing" : "mw-provenance-row__value"}>
          {value ?? "Not provided"}
        </span>
        {detail && <span className="mw-provenance-row__detail">{detail}</span>}
      </dd>
    </div>
  );
}

export default ProvenanceRow;
