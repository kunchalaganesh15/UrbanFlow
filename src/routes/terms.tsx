import { createFileRoute, Link } from "@tanstack/react-router";
import { meta } from "@/lib/traffic";

export const Route = createFileRoute("/terms")({
  head: () => meta("Terms and Conditions", "Usage limitations and safety notices for the UrbanFlow traffic-analysis research prototype."),
  component: TermsPage,
});

function TermsPage() {
  return <div className="legal-page">
    <div className="eyebrow"><span className="eyebrow-line"/> LEGAL / TERMS</div>
    <h1>Terms and conditions</h1>
    <p className="legal-intro">These prototype terms explain the limits of the supplied UrbanFlow project. They require review and adaptation to your organization and jurisdiction before public launch.</p>
    <section><h2>Intended use</h2><p>UrbanFlow is provided for research, development, and evaluation of recorded traffic footage. It is not certified to control physical intersections, direct emergency responders, or make safety-critical decisions. Never connect it to live traffic signal hardware without independent engineering, validation, and applicable approvals.</p></section>
    <section><h2>Detection limitations</h2><p>Detection quality depends on video conditions and model training. The default general-purpose YOLO model does not distinguish ambulances or fire trucks. Emergency priority requires a compatible custom model that actually includes those classes. Outputs must be checked by a qualified operator and should not be treated as guaranteed accurate.</p></section>
    <section><h2>Footage rights</h2><p>Only upload footage you are entitled to process. The person or organization operating the local analysis service is responsible for access controls, lawful use, and deletion of video files.</p></section>
    <section><h2>Deployment review</h2><p>Before publishing, add your organization’s legal identity, contact details, jurisdiction-specific terms, and operational policies. Read the <Link to="/privacy">privacy policy</Link> for the supplied video handling workflow.</p></section>
  </div>;
}