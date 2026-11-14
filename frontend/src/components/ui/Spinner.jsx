import { LoaderCircle } from "lucide-react";

function Spinner({ size = 16, className = "" }) {
  return <LoaderCircle className={`mw-spinner ${className}`} size={size} strokeWidth={2} aria-hidden="true" />;
}

export default Spinner;
