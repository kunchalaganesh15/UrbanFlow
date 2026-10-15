import { createFileRoute, Link } from "@tanstack/react-router";
import { meta } from "@/lib/traffic";

export const Route = createFileRoute("/privacy")({
  head: () => meta("Privacy Policy", "How UrbanFlow handles uploaded traffic footage and detection data in its local analysis workflow."),
  component: PrivacyPage,
});

function PrivacyPage() {
  return <div className="legal-page">
    <div className="eyebrow"><span className="eyebrow-line"/> LEGAL / PRIVACY</div>
    <h1>Privacy policy</h1>
    <p className="legal-intro">UrbanFlow is a research prototype. This page describes the supplied local video-analysis workflow, not a deployed traffic-monitoring service. Review this policy for your actual deployment before launch.</p>
    <section><h2>Footage and analysis</h2><p>When you upload footage in the app, your browser sends it to the Python analysis service configured for your installation. That service stores uploaded files in its operating system’s temporary UrbanFlow video directory and processes frames for vehicle detections, tracking IDs, counts, and signal decisions. Uploading a replacement video removes the previous file for that road. Stopping analysis preserves the latest statistics in service memory; it does not automatically delete uploaded footage.</p></section>
    <section><h2>Access and retention</h2><p>The supplied local service does not include user accounts, automatic retention limits, or a footage deletion screen. Its operator must control who can reach it, remove temporary files when no longer needed, and set an appropriate retention policy before handling real footage.</p></section>
    <section><h2>External services</h2><p>The interface loads typefaces from Google Fonts. The default model may be downloaded when the local analysis service first starts. The supplied application does not intentionally send uploaded footage to an AI image service.</p></section>
    <section><h2>Your deployment</h2><p>If you deploy this software, replace this prototype disclosure with your organization’s privacy policy, contact details, retention period, and any legally required rights or notices. See the <Link to="/terms">terms and conditions</Link> for usage limits.</p></section>
  </div>;
}