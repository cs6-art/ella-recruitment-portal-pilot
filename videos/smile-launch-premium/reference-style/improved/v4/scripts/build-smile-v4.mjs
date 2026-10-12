import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] || ".");
const W = 1920;
const H = 1080;
const DURATION = 25;
mkdirSync(resolve(out, "renders"), { recursive: true });

const logo = '<img class="logo" src="assets/smile-recruitment-portal-logo.png" alt="Smile">';
const wave = Array.from({ length: 36 }, (_, i) => {
  const heights = [12, 18, 24, 34, 21, 15, 29, 42, 26, 18, 36, 50, 31, 19, 39, 56, 32, 20, 45, 59, 36, 21, 40, 55, 29, 18, 35, 47, 24, 15, 30, 42, 22, 13, 25, 34];
  return `<i style="--h:${heights[i]}px"></i>`;
}).join("");

const css = `
@font-face{font-family:Manrope;src:url("assets/fonts/Manrope.ttf") format("truetype");font-weight:400 800;font-display:block}
*{box-sizing:border-box;margin:0}
html,body,#root{width:${W}px;height:${H}px;overflow:hidden}
#root{position:relative;background:#fffaf6;color:#17243a;font-family:Manrope,Arial,sans-serif}
.glow{position:absolute;inset:0;background:radial-gradient(ellipse at 4% 89%,#ffd9cbbd 0,transparent 42%),radial-gradient(ellipse at 97% 5%,#e5dcf4a8 0,transparent 43%),#fffaf6}
.grid{position:absolute;inset:-2px;background-image:linear-gradient(#4739360c 1px,transparent 1px),linear-gradient(90deg,#4739360c 1px,transparent 1px);background-size:56px 56px;mask-image:linear-gradient(90deg,#000 0%,#000b 73%,#0004 100%)}
.brand{position:absolute;left:138px;top:64px;display:flex;align-items:center;gap:11px;z-index:20;font-size:26px;font-weight:800;letter-spacing:-.04em}
.logo{width:42px;height:42px;object-fit:contain}
.brand-sub{font-size:13px;font-weight:600;letter-spacing:.01em;color:#596779;margin-left:2px}
.pilot{position:absolute;right:145px;top:73px;padding:10px 15px;border:1px solid #dfe5ed;border-radius:30px;background:#fffaf4db;color:#52647b;font-size:12px;font-weight:800;letter-spacing:.08em;z-index:20}
.pilot i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f7cf00;margin-right:8px}
.story{position:absolute;left:150px;top:255px;width:535px;height:600px;z-index:3}
.story-state{position:absolute;inset:0;opacity:0}
.eyebrow{font-size:15px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#216cad;margin-bottom:19px}
.story h1{font-size:69px;line-height:1.04;letter-spacing:-.065em;font-weight:800;color:#152239;max-width:530px}
.story p{font-size:22px;line-height:1.48;color:#53647b;margin-top:21px;max-width:470px}
.story-rule{width:74px;height:5px;background:#0069df;border-radius:8px;margin-top:28px;transform-origin:left center}
.folio-shadow{position:absolute;left:805px;top:226px;width:972px;height:692px;border-radius:32px;background:#dce5f0;opacity:.62;transform:rotate(1.8deg);box-shadow:0 34px 80px #26355210}
.folio{position:absolute;left:785px;top:196px;width:972px;height:692px;border:1px solid #e4e8ed;border-radius:30px;background:#fffffffa;box-shadow:0 28px 84px #28364a20;overflow:hidden;transform-origin:50% 52%;z-index:4;will-change:transform}
.folio-edge{position:absolute;left:0;top:0;bottom:0;width:6px;background:linear-gradient(#0069df,#f7cf00)}
.screen{position:absolute;inset:0;padding:44px 48px 40px;opacity:0;will-change:transform,opacity}
.screen-head{display:flex;align-items:center;justify-content:space-between;color:#526176;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.screen-head .flag{padding:7px 11px;border-radius:30px;color:#536177;background:#f2f5f8;border:1px solid #e5e9ef;letter-spacing:.06em}
.screen-title{font-size:29px;line-height:1.1;letter-spacing:-.04em;font-weight:800;color:#18263d;margin-top:22px}
.screen-subtitle{font-size:16px;line-height:1.45;color:#536379;margin-top:8px}
.blue{color:#0069df}.muted{color:#55667d}.green{color:#27826b}.yellow{color:#977900}
.micro{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#596a80}
.role-grid{display:grid;grid-template-columns:1.04fr .96fr;gap:20px;margin-top:27px;height:410px}
.brief-panel,.draft-panel,.applicant-panel,.evidence-panel,.invite-panel,.choice-card,.call-panel,.transcript-panel,.summary-panel,.calendar-panel{border:1px solid #e2e7ed;border-radius:18px;background:#fff;position:relative;overflow:hidden}
.brief-panel{padding:24px 25px;background:#f8fafc}
.brief-panel h2{font-size:31px;line-height:1.12;letter-spacing:-.05em;margin-top:15px;color:#1a2b41;max-width:390px}
.brief-panel p{font-size:17px;line-height:1.5;color:#53647a;margin-top:12px;max-width:390px}
.brief-kicker{font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:#53647a}
.brief-lines{margin-top:28px;display:flex;flex-direction:column;gap:13px}
.brief-lines i{display:block;height:8px;border-radius:9px;background:#dfe7ee;width:92%;transform-origin:left center}
.brief-lines i:nth-child(2){width:78%}.brief-lines i:nth-child(3){width:88%}.brief-lines i:nth-child(4){width:56%}
.draft-panel{padding:24px 23px}
.draft-head{display:flex;align-items:center;justify-content:space-between}
.draft-head h3{font-size:21px;letter-spacing:-.03em}
.draft-badge{font-size:11px;font-weight:800;color:#246eae;background:#eaf3fc;padding:8px 10px;border-radius:30px}
.draft-row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #e9edf1;padding:22px 0;font-size:17px;font-weight:700;color:#34445b;opacity:0}
.draft-row:last-child{border:0}
.checkmark{width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:#e8f4ff;color:#0064ad;font-size:14px;flex:none}
.screen-footer{position:absolute;left:48px;right:48px;bottom:35px;display:flex;align-items:center;justify-content:space-between}
.foot-note{font-size:14px;color:#53647a;font-weight:600}
.btn{border:0;border-radius:30px;padding:14px 20px;background:#0069df;color:white;font:800 15px Manrope,Arial,sans-serif;box-shadow:0 7px 18px #0069df29;display:inline-flex;align-items:center;gap:10px}
.btn .arrow{font-size:18px;line-height:14px}
.publish-done{position:absolute;right:48px;bottom:39px;display:flex;align-items:center;gap:9px;color:#25745f;font-size:14px;font-weight:800;background:#e9f7f1;padding:13px 16px;border-radius:30px;opacity:0}
.publish-done i{width:9px;height:9px;background:#31a07e;border-radius:50%}
.applicant-top{display:flex;align-items:center;gap:15px;margin-top:24px}
.avatar-initials{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#f9e8de;color:#7b4e3e;font-size:18px;font-weight:800}
.applicant-name{font-size:23px;font-weight:800;letter-spacing:-.03em}
.applicant-role{font-size:14px;color:#526379;margin-top:4px}
.cv-grid{display:grid;grid-template-columns:.86fr 1.14fr;gap:18px;margin-top:25px;height:393px}
.applicant-panel{padding:22px;background:#f8fafc}
.resume-file{margin-top:22px;border:1px solid #e3e9ee;background:#fff;border-radius:14px;display:flex;align-items:center;gap:14px;padding:17px 14px}
.pdf-icon{width:48px;height:54px;border-radius:9px;display:grid;place-items:center;background:#eaf3fc;color:#0064ad;font-size:13px;font-weight:900}
.file-name{font-size:14px;font-weight:800;color:#34445b}
.file-meta{font-size:12px;color:#5a6a7d;margin-top:4px}
.applicant-status{display:flex;align-items:center;gap:8px;margin-top:20px;font-size:14px;font-weight:800;color:#865d42}
.status-dot{width:8px;height:8px;border-radius:50%;background:#e1a35e}
.evidence-panel{padding:21px 22px}
.evidence-title{font-size:19px;font-weight:800;letter-spacing:-.025em}
.evidence-row{display:grid;grid-template-columns:1fr auto;align-items:end;gap:10px;margin-top:21px;opacity:0}
.evidence-row b{font-size:15px;color:#34445b}
.evidence-row span{font-size:12px;font-weight:700;color:#53647a}
.bar-track{grid-column:1 / -1;height:10px;border-radius:8px;background:#ebeff3;overflow:hidden}
.bar-fill{display:block;width:100%;height:100%;transform:scaleX(0);transform-origin:left center;border-radius:8px;background:#0069df}
.bar-fill.alt{background:#5a91cc}.bar-fill.third{background:#87aed6}
.match-score{position:absolute;right:22px;bottom:19px;display:flex;align-items:baseline;gap:9px;opacity:0}
.match-score strong{font-size:47px;line-height:1;color:#0069df;letter-spacing:-.06em}
.match-score span{font-size:13px;color:#53647a;font-weight:800}
.hr-gate{position:absolute;left:48px;right:48px;bottom:34px;height:66px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e7ebef;padding-top:14px;opacity:0}
.hr-gate b{font-size:15px;color:#31425a}
.decision-actions{display:flex;gap:9px}
.decision-actions span{border:1px solid #dce4ed;border-radius:25px;padding:10px 13px;color:#536379;font-size:12px;font-weight:800;background:#fff}
.decision-actions .approve{border-color:#0069df;background:#0069df;color:#fff}
.invite-send-gate{position:absolute;left:48px;right:48px;bottom:34px;height:66px;align-items:center;justify-content:space-between;border-top:1px solid #e7ebef;padding-top:14px;opacity:0}
.invite-send-gate b{font-size:15px;color:#31425a}
.invite-send-btn{padding:11px 16px}
.invite-sent{display:none;align-items:center;gap:9px;color:#25745f;font-size:13px;font-weight:800;background:#e9f7f1;padding:12px 15px;border-radius:30px}
.invite-sent i{width:9px;height:9px;background:#31a07e;border-radius:50%}
.invite-layout{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:31px;height:405px}
.choice-card{padding:24px 22px}
.choice-card.voice{border:2px solid #0069df;background:#f8fbff;box-shadow:0 12px 34px #0069df18}
.choice-card.avatar{background:#fafbfc;color:#53647a;opacity:.74}
.choice-icon{width:48px;height:48px;border-radius:14px;background:#eaf3fc;color:#0069df;display:grid;place-items:center;margin-bottom:19px}
.choice-icon svg{width:26px;height:26px}
.choice-label{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#53647a}
.choice-card h3{font-size:26px;letter-spacing:-.04em;margin-top:9px}
.choice-card p{font-size:15px;line-height:1.5;color:#53647a;margin-top:10px;max-width:340px}
.choice-meta{position:absolute;left:22px;bottom:20px;font-size:13px;font-weight:800;color:#49647f}
.choice-card.avatar .choice-meta{color:#55667d}
.select-format{position:absolute;right:18px;bottom:15px;border-radius:25px;background:#0069df;color:white;padding:12px 15px;font-size:12px;font-weight:800;opacity:0}
.selected-stamp{position:absolute;right:18px;top:18px;border-radius:25px;background:#e5f3ff;color:#126cb2;padding:9px 12px;font-size:11px;font-weight:900;letter-spacing:.05em;opacity:0}
.call-layout{display:grid;grid-template-columns:.76fr 1.24fr;gap:22px;margin-top:26px;height:425px}
.call-panel{background:#f7faff;padding:26px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.phone-orb{width:120px;height:120px;border-radius:50%;background:#0069df;color:#fff;display:grid;place-items:center;box-shadow:0 20px 42px #0069df33;position:relative}
.phone-orb svg{width:44px;height:44px}
.phone-ring{position:absolute;inset:-12px;border:2px solid #0069df4a;border-radius:50%;transform:scale(.7);opacity:0}
.call-state{font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:900;color:#0068b4;margin-top:22px}
.call-length{font-size:14px;color:#53647a;margin-top:7px}
.waveform{height:84px;width:100%;display:flex;align-items:center;justify-content:center;gap:5px;margin-top:12px}
.waveform i{display:block;width:7px;height:var(--h);border-radius:6px;background:#1584d6;transform:scaleY(.15);transform-origin:center}
.call-copy{padding:25px 28px;border:1px solid #e2e8ee;border-radius:18px;background:#fff;display:flex;flex-direction:column;justify-content:center}
.call-copy .micro{margin-bottom:14px}
.call-question{font-size:23px;line-height:1.25;font-weight:800;color:#24334a;max-width:430px}
.call-answer{font-size:18px;line-height:1.5;color:#596a81;margin-top:20px;padding-left:16px;border-left:4px solid #0069df;max-width:440px;clip-path:inset(0 100% 0 0)}
.call-answer small{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;color:#526379;margin-bottom:6px}
.review-layout{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;margin-top:29px;height:400px}
.transcript-panel{padding:24px;background:#f8fafc}
.transcript-label{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#53647a}
.transcript-q{font-size:15px;font-weight:800;color:#4c5c73;margin-top:25px}
.transcript-answer{font-size:21px;line-height:1.48;color:#27374d;margin-top:12px;clip-path:inset(0 100% 0 0)}
.evidence-tag{display:inline-flex;margin-top:18px;border-radius:25px;padding:9px 12px;background:#eaf3fc;color:#176eae;font-size:12px;font-weight:800}
.summary-panel{padding:24px}
.summary-panel h3{font-size:20px;letter-spacing:-.03em}
.summary-panel p{font-size:16px;line-height:1.5;color:#53647a;margin-top:13px}
.finding-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:19px}
.finding{padding:14px 13px;border-radius:12px;opacity:0}
.finding.good{background:#e8f4ed}
.finding.follow-up{background:#fff2e8}
.finding-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:900;color:#53647a}
.finding-value{font-size:13px;line-height:1.35;font-weight:800;color:#34445b;margin-top:7px}
.summary-list{display:flex;flex-direction:column;gap:12px;margin-top:19px}
.summary-list span{font-size:14px;color:#3f536c;display:flex;align-items:center;gap:10px}
.summary-list i{width:9px;height:9px;border-radius:50%;background:#0069df}
.review-decision{position:absolute;left:48px;right:48px;bottom:32px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e7ebef;padding-top:14px;opacity:0}
.review-decision b{font-size:14px;color:#536278}
.review-buttons{display:flex;gap:10px}
.review-buttons span{padding:11px 16px;border-radius:25px;border:1px solid #dce4ed;color:#53647a;font-size:13px;font-weight:800;background:#fff}
.review-buttons .next-step{background:#0069df;border-color:#0069df;color:#fff}
.calendar-intro{display:flex;align-items:center;gap:18px;margin-top:27px}
.calendar-icon{width:55px;height:55px;border-radius:16px;display:grid;place-items:center;color:#0069df;background:#eaf3fc}
.calendar-icon svg{width:29px;height:29px}
.calendar-intro h3{font-size:21px;letter-spacing:-.025em}
.calendar-intro p{font-size:14px;color:#53647a;margin-top:5px}
.calendar-panel{margin-top:26px;padding:22px;background:#f9fbfd;height:390px;display:flex;flex-direction:column;justify-content:center}
.calendar-caption{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#526379}
.slot-row{display:flex;gap:16px;margin-top:32px}
.slot{flex:1;border:1px solid #dfe6ed;border-radius:16px;padding:29px 12px;text-align:center;background:#fff;color:#4a5c73;font-size:19px;font-weight:800;opacity:0}
.slot small{display:block;font-size:12px;color:#53647a;font-weight:700;margin-top:9px}
.slot.selected{border:2px solid #0069df;color:#126caf;background:#f7fbff}
.calendar-footer{display:flex;align-items:center;justify-content:space-between;margin-top:28px;font-size:14px;color:#53647a}
.calendar-footer b{color:#1c6eaf;font-weight:800}
.closing{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0;z-index:10}
.closing .close-brand{display:flex;align-items:center;gap:15px}
.close-brand .logo{width:82px;height:82px}
.close-brand b{font-size:88px;letter-spacing:-.07em;color:#17243a}
.closing .product-name{font-size:21px;color:#53647a;margin-top:8px}
.closing h2{font-size:51px;letter-spacing:-.055em;margin-top:31px;color:#17243a}
.closing p{font-size:19px;color:#53647b;margin-top:11px}
.cta{display:inline-flex;align-items:center;gap:16px;border-radius:45px;padding:18px 28px;margin-top:29px;border:1px solid #dfe6ed;background:#fff;color:#17243a;box-shadow:0 12px 34px #17243a16;font-size:22px;font-weight:800}
.cta em{font-style:normal;color:#0069df;font-size:25px}
.close-note{font-size:12px;color:#55667d;margin-top:19px;font-weight:700;letter-spacing:.04em}
.cursor{position:absolute;left:1668px;top:830px;width:35px;height:42px;z-index:30;opacity:0;filter:drop-shadow(0 2px 2px #1c2d4655);pointer-events:none}
.cursor svg{width:100%;height:100%}
.ripple{position:absolute;left:1605px;top:810px;width:38px;height:38px;border:2px solid #0069df;border-radius:50%;transform:scale(0);opacity:0;z-index:29;pointer-events:none}
.audio-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${W},initial-scale=1"><title>Smile Recruitment Portal — Motion-led product demo</title><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>${css}</style></head><body><div id="root" data-composition-id="main" data-width="${W}" data-height="${H}" data-duration="${DURATION}">
  <div class="glow"></div><div class="grid"></div>
  <div class="brand">${logo}<span>Smile</span><span class="brand-sub">Recruitment Portal</span></div>
  <div class="pilot"><i></i>PILOT · SYNTHETIC EXAMPLE</div>
  <div class="story">
    <div class="story-state story-role"><div class="eyebrow">One role · a clearer start</div><h1>Define the role before applicants arrive.</h1><p>Smile drafts the role details, screening criteria, and interview questions. HR reviews before publishing.</p><div class="story-rule"></div></div>
    <div class="story-state story-cv"><div class="eyebrow">Applicant · resume evidence</div><h1>See the match behind the score.</h1><p>Review the resume against the role criteria, with strengths and gaps visible to HR.</p><div class="story-rule"></div></div>
    <div class="story-state story-invite"><div class="eyebrow">After HR review</div><h1>Let the candidate take one route.</h1><p>When both interview formats are enabled, the candidate chooses one from the invitation.</p><div class="story-rule"></div></div>
    <div class="story-state story-call"><div class="eyebrow">Voice interview · scheduled call</div><h1>Make the conversation count.</h1><p>A 10-minute phone interview follows the role's questions. The candidate confirms a mobile number.</p><div class="story-rule"></div></div>
    <div class="story-state story-review"><div class="eyebrow">Interview evidence</div><h1>AI summarizes. HR decides.</h1><p>Transcript, score, summary, and response evidence return to the human reviewer.</p><div class="story-rule"></div></div>
    <div class="story-state story-calendar"><div class="eyebrow">After HR approval</div><h1>Choose the next conversation.</h1><p>When face-to-face interviews are enabled, the candidate picks an available one-hour slot.</p><div class="story-rule"></div></div>
  </div>

  <div class="folio-shadow"></div><div class="folio" id="folio"><div class="folio-edge"></div>
    <section class="screen role-screen">
      <div class="screen-head"><span>ROLE SETUP · SYNTHETIC DEMO</span><span class="flag">HR REVIEW</span></div>
      <div class="role-grid">
        <div class="brief-panel"><div class="brief-kicker">Job description</div><h2>Product Marketing Lead</h2><p>Lead product launches, positioning, campaign insight, and sales alignment.</p><div class="brief-lines"><i></i><i></i><i></i><i></i></div></div>
        <div class="draft-panel"><div class="draft-head"><h3>Smile drafted</h3><span class="draft-badge">Review this role</span></div><div class="draft-row"><span class="checkmark">✓</span>Role details</div><div class="draft-row"><span class="checkmark">✓</span>Screening criteria</div><div class="draft-row"><span class="checkmark">✓</span>Interview questions</div></div>
      </div>
      <div class="screen-footer"><span class="foot-note">HR checks the draft before it goes live.</span><button class="btn publish-btn">Publish role <span class="arrow">↗</span></button></div>
      <div class="publish-done"><i></i>Role published · link ready</div>
    </section>

    <section class="screen cv-screen">
      <div class="screen-head"><span>APPLICATION · SYNTHETIC CANDIDATE</span><span class="flag">CV ANALYSIS</span></div>
      <div class="applicant-top"><div class="avatar-initials">MC</div><div><div class="applicant-name">Maya Chen</div><div class="applicant-role">Product Marketing Lead · synthetic demo</div></div></div>
      <div class="cv-grid">
        <div class="applicant-panel"><div class="micro">Candidate submitted</div><div class="resume-file"><span class="pdf-icon">PDF</span><span><b class="file-name">Resume_Maya_Chen.pdf</b><span class="file-meta">Application link · privacy notice acknowledged</span></span></div><div class="applicant-status"><i class="status-dot"></i>Awaiting HR review</div><div class="micro" style="margin-top:25px">Role applied</div><div style="font-size:17px;font-weight:800;color:#34445b;margin-top:8px">Product Marketing Lead</div></div>
        <div class="evidence-panel"><div class="evidence-title">Evidence against role criteria</div>
          <div class="evidence-row evidence-a"><b>Campaign analytics</b><span>Strong evidence</span><div class="bar-track"><i class="bar-fill fill-a"></i></div></div>
          <div class="evidence-row evidence-b"><b>Product positioning</b><span>Relevant experience</span><div class="bar-track"><i class="bar-fill alt fill-b"></i></div></div>
          <div class="evidence-row evidence-c"><b>Cross-team leadership</b><span>Review in context</span><div class="bar-track"><i class="bar-fill third fill-c"></i></div></div>
          <div class="match-score"><strong>82</strong><span>/100 · synthetic match<br>Review aid, not a decision</span></div>
        </div>
      </div>
      <div class="hr-gate"><b>HR reviews CV evidence before any interview.</b><div class="decision-actions"><span>Reject</span><span class="approve cv-approve">Approve</span></div></div>
      <div class="invite-send-gate"><b>CV approved · HR sends the interview invite separately.</b><button class="btn invite-send-btn">Send interview invitation</button><span class="invite-sent"><i></i>Invitation sent · one format choice</span></div>
    </section>

    <section class="screen invite-screen">
      <div class="screen-head"><span>INTERVIEW INVITATION · MAYA CHEN</span><span class="flag">ROLE SETTING · BOTH</span></div>
      <div class="screen-title">Choose one interview format.</div><div class="screen-subtitle">This role offers Voice and Live Avatar. The candidate completes one format.</div>
      <div class="invite-layout">
        <div class="choice-card voice"><span class="selected-stamp voice-selected">SELECTED</span><div class="choice-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h4l2 5-3 2a15 15 0 0 0 7 7l2-3 5 2v4c0 1.1-.9 2-2 2C9 22 2 15 2 5c0-1.1.9-2 2-2Z"/></svg></div><div class="choice-label">Option 1</div><h3>Voice Interview</h3><p>Book a 10-minute phone call. Smile calls at the scheduled time.</p><div class="choice-meta">Phone · scheduled</div><span class="select-format">Continue</span></div>
        <div class="choice-card avatar"><div class="choice-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 10 4-2v8l-4-2M10 9v6m-3-3h6"/></svg></div><div class="choice-label">Option 2</div><h3>Live Avatar</h3><p>Open the private link, review the notice, consent, and complete camera and microphone checks.</p><div class="choice-meta">Video · one-time link</div></div>
      </div>
      <div class="screen-footer"><span class="foot-note">Sent after HR approval · one interview path.</span><span class="draft-badge">Synthetic example</span></div>
    </section>

    <section class="screen call-screen">
      <div class="screen-head"><span>VOICE INTERVIEW · SYNTHETIC EXAMPLE</span><span class="flag">10-MINUTE PHONE CALL</span></div>
      <div class="call-layout">
        <div class="call-panel"><div class="phone-orb"><span class="phone-ring"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h4l2 5-3 2a15 15 0 0 0 7 7l2-3 5 2v4c0 1.1-.9 2-2 2C9 22 2 15 2 5c0-1.1.9-2 2-2Z"/></svg></div><div class="call-state">Call in progress</div><div class="call-length">Maya confirmed a mobile number</div><div class="waveform">${wave}</div></div>
        <div class="call-copy"><div class="micro">Role question · candidate response</div><div class="call-question">“Tell me about a launch you led.”</div><div class="call-answer"><small>Maya Chen</small>“I aligned product and sales around one launch story, then tracked campaign performance.”</div></div>
      </div>
      <div class="screen-footer"><span class="foot-note">Role questions guide the interview.</span><span class="draft-badge">Voice route selected</span></div>
    </section>

    <section class="screen review-screen">
      <div class="screen-head"><span>VOICE INTERVIEW REVIEW · MAYA CHEN</span><span class="flag">HUMAN DECISION PENDING</span></div>
      <div class="review-layout">
        <div class="transcript-panel"><div class="transcript-label">Transcript excerpt · synthetic</div><div class="transcript-q">QUESTION · PRODUCT POSITIONING</div><div class="transcript-answer">“I aligned product and sales around one launch story, then tracked campaign performance.”</div><span class="evidence-tag">Response evidence</span></div>
        <div class="summary-panel"><div class="micro">AI summary · synthetic</div><h3>Reviewable interview evidence</h3><p>Transcript, score, strengths, and areas to clarify return to HR for review.</p><div class="finding-pair"><div class="finding good"><div class="finding-label">Strength</div><div class="finding-value">Cross-team launch work</div></div><div class="finding follow-up"><div class="finding-label">Follow up</div><div class="finding-value">Depth of measurement</div></div></div></div>
      </div>
      <div class="review-decision"><b>HR decides whether Maya advances.</b><div class="review-buttons"><span>Reject</span><span class="next-step review-approve">Approve next stage</span></div></div>
    </section>

    <section class="screen calendar-screen">
      <div class="screen-head"><span>AFTER HR APPROVAL · CANDIDATE BOOKING</span><span class="flag">SYNTHETIC AVAILABILITY</span></div>
      <div class="calendar-intro"><div class="calendar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/></svg></div><div><h3>Face-to-face interview · 1 hour</h3><p>Choose from available time on the configured interviewer or HR calendar.</p></div></div>
      <div class="calendar-panel"><div class="calendar-caption">Example available times · choose one</div><div class="slot-row"><div class="slot slot-a">10:00–11:00<small>One-hour slot</small></div><div class="slot slot-b selected">13:30–14:30<small>One-hour slot</small></div><div class="slot slot-c">15:00–16:00<small>One-hour slot</small></div></div><div class="calendar-footer"><span>Availability depends on the connected calendar.</span><b class="slot-chosen">Candidate selects a time</b></div></div>
    </section>
  </div>

  <div class="cursor"><svg viewBox="0 0 32 40" fill="none"><path d="M3 2v30l7-7 5 12 5-2-5-12h11L3 2Z" fill="#fff" stroke="#17243a" stroke-width="2.5" stroke-linejoin="round"/></svg></div><div class="ripple"></div>
  <div class="closing"><div class="close-brand"><b>Smile</b></div><div class="product-name">Recruitment Portal</div><h2>Make hiring feel more human.</h2><p>AI assists. HR decides.</p><div class="cta">Try Smile now <em>↗</em></div><div class="close-note">A clearer path from application to human review</div></div>

  <div class="audio-only"><audio id="bgm" class="clip" src="assets/audio/smile-original-score.wav" data-start="0" data-duration="25" data-track-index="10" data-volume=".62"></audio>
    <audio id="sfx-role" class="clip" src="assets/audio/paper-flick.wav" data-start=".12" data-duration=".42" data-track-index="11" data-volume=".36"></audio>
    <audio id="sfx-publish" class="clip" src="assets/audio/ui-tick.wav" data-start="2.86" data-duration=".12" data-track-index="11" data-volume=".32"></audio>
    <audio id="sfx-match" class="clip" src="assets/audio/impact-soft.wav" data-start="6.55" data-duration=".34" data-track-index="11" data-volume=".3"></audio>
    <audio id="sfx-invite" class="clip" src="assets/audio/sweep-short.wav" data-start="8.12" data-duration=".58" data-track-index="11" data-volume=".3"></audio>
    <audio id="sfx-call" class="clip" src="assets/audio/phone-tone.wav" data-start="13.1" data-duration=".24" data-track-index="11" data-volume=".32"></audio>
    <audio id="sfx-review" class="clip" src="assets/audio/paper-flick.wav" data-start="17.18" data-duration=".42" data-track-index="11" data-volume=".29"></audio>
    <audio id="sfx-approve" class="clip" src="assets/audio/ui-tick.wav" data-start="19.72" data-duration=".12" data-track-index="11" data-volume=".33"></audio>
    <audio id="sfx-calendar" class="clip" src="assets/audio/impact-soft.wav" data-start="20.45" data-duration=".34" data-track-index="11" data-volume=".26"></audio>
    <audio id="sfx-cta" class="clip" src="assets/audio/cta-confirm.wav" data-start="23.16" data-duration=".62" data-track-index="11" data-volume=".38"></audio>
  </div>

  <script>
  (function(){
    const q=(s)=>document.querySelector(s), all=(s)=>Array.from(document.querySelectorAll(s));
    const tl=gsap.timeline({paused:true,defaults:{ease:"power3.out"}});
    const showStory=(from,to,at,dir=1)=>{
      const nextAt=from?at+.24:at;
      if(from) tl.to(from,{x:dir*-34,opacity:0,duration:.24,ease:"power1.in"},at);
      tl.fromTo(to,{x:dir*42,y:8,opacity:0},{x:0,y:0,opacity:1,duration:.46,ease:"power3.out"},nextAt);
      tl.fromTo(to+" .story-rule",{scaleX:0},{scaleX:1,duration:.34,ease:"power2.out"},nextAt+.38);
    };
    const swap=(from,to,at,exitX,enterX)=>{
      tl.to(from,{x:exitX,scale:.97,opacity:0,duration:.27,ease:"power1.in"},at);
      tl.fromTo(to,{x:enterX,scale:.96,opacity:0},{x:0,scale:1,opacity:1,duration:.48,ease:"power3.out"},at+.13);
      tl.to("#folio",{rotation:exitX<0?1.1:-.9,scale:1.018,duration:.26,ease:"power2.inOut"},at);
      tl.to("#folio",{rotation:0,scale:1,duration:.38,ease:"power2.out"},at+.28);
    };

    tl.fromTo(".brand",{y:-20,opacity:0},{y:0,opacity:1,duration:.45,ease:"power3.out"},.12);
    tl.fromTo(".pilot",{y:-14,opacity:0},{y:0,opacity:1,duration:.36,ease:"power2.out"},.28);
    tl.fromTo(".folio-shadow",{x:36,y:18,rotation:5,opacity:0},{x:0,y:0,rotation:1.8,opacity:.62,duration:.7,ease:"power2.out"},.08);
    tl.fromTo("#folio",{x:96,y:54,rotation:-6,scale:.88,opacity:0},{x:0,y:0,rotation:0,scale:1,opacity:1,duration:.82,ease:"power3.out"},.16);
    tl.fromTo(".role-screen",{x:54,y:22,rotation:-1.2,scale:.97,opacity:0},{x:0,y:0,rotation:0,scale:1,opacity:1,duration:.55,ease:"power3.out"},.48);
    showStory(null,".story-role",.34,1);
    tl.fromTo(".brief-panel",{x:-22,opacity:0},{x:0,opacity:1,duration:.42,ease:"power2.out"},.78);
    tl.fromTo(".brief-lines i",{scaleX:0},{scaleX:1,duration:.26,stagger:.08,ease:"power2.out"},1.42);
    tl.fromTo(".draft-row",{x:20,opacity:0},{x:0,opacity:1,duration:.32,stagger:.12,ease:"power3.out"},1.56);
    tl.fromTo(".screen-footer",{y:12,opacity:0},{y:0,opacity:1,duration:.32,ease:"power2.out"},2.12);
    tl.fromTo(".cursor",{x:0,y:0,opacity:0},{x:-35,y:-3,opacity:1,duration:.46,ease:"power3.out"},2.38);
    tl.to(".publish-btn",{scale:.95,duration:.09,yoyo:true,repeat:1,ease:"power1.inOut"},2.85);
    tl.to(".publish-btn",{scale:.96,opacity:0,duration:.13,ease:"power1.in"},3.04);
    tl.set(".publish-done",{display:"flex"},3.17);
    tl.fromTo(".publish-done",{y:8,opacity:0},{y:0,opacity:1,duration:.28,ease:"power2.out"},3.17);
    tl.to(".cursor",{x:-46,y:-4,opacity:0,duration:.2,ease:"power1.in"},3.2);
    tl.fromTo(".ripple",{scale:0,opacity:.55},{scale:3.1,opacity:0,duration:.42,ease:"power2.out"},2.88);

    swap(".role-screen",".cv-screen",3.6,-44,52);
    showStory(".story-role",".story-cv",3.66,-1);
    tl.fromTo(".applicant-top",{x:-26,opacity:0},{x:0,opacity:1,duration:.4,ease:"power2.out"},3.9);
    tl.fromTo(".applicant-panel",{x:-26,opacity:0},{x:0,opacity:1,duration:.38,ease:"power2.out"},4.18);
    tl.fromTo(".resume-file",{y:14,rotation:-2,opacity:0},{y:0,rotation:0,opacity:1,duration:.4,ease:"power3.out"},4.5);
    tl.fromTo(".evidence-panel",{x:30,opacity:0},{x:0,opacity:1,duration:.42,ease:"power2.out"},4.45);
    tl.fromTo(".evidence-row",{x:20,opacity:0},{x:0,opacity:1,duration:.3,stagger:.16,ease:"power2.out"},4.92);
    tl.to(".fill-a",{scaleX:.86,duration:.65,ease:"power2.out"},5.25);
    tl.to(".fill-b",{scaleX:.72,duration:.62,ease:"power2.out"},5.56);
    tl.to(".fill-c",{scaleX:.61,duration:.6,ease:"power2.out"},5.88);
    tl.fromTo(".match-score",{y:18,scale:.9,opacity:0},{y:0,scale:1,opacity:1,duration:.38,ease:"back.out(1.25)"},6.42);
    tl.fromTo(".hr-gate",{y:16,opacity:0},{y:0,opacity:1,duration:.36,ease:"power2.out"},7.05);
    tl.to(".cv-approve",{scale:.96,duration:.1,yoyo:true,repeat:1,ease:"power1.inOut"},7.62);
    tl.to(".hr-gate",{y:-8,opacity:0,duration:.18,ease:"power1.in"},7.78);
    tl.set(".hr-gate",{display:"none"},7.96);
    tl.set(".invite-send-gate",{display:"flex"},7.96);
    tl.fromTo(".invite-send-gate",{y:12,opacity:0},{y:0,opacity:1,duration:.28,ease:"power2.out"},7.96);
    tl.to(".invite-send-btn",{scale:.96,duration:.1,yoyo:true,repeat:1,ease:"power1.inOut"},8.13);
    tl.to(".invite-send-btn",{opacity:0,duration:.1,ease:"power1.in"},8.34);
    tl.set(".invite-send-btn",{display:"none"},8.44);
    tl.set(".invite-sent",{display:"flex"},8.44);
    tl.fromTo(".invite-sent",{x:12,opacity:0},{x:0,opacity:1,duration:.22,ease:"power2.out"},8.44);

    swap(".cv-screen",".invite-screen",8.58,64,-56);
    showStory(".story-cv",".story-invite",8.64,1);
    tl.fromTo(".choice-card.voice",{x:-24,rotation:-2,opacity:0},{x:0,rotation:0,opacity:1,duration:.42,ease:"power3.out"},9.0);
    tl.fromTo(".choice-card.avatar",{x:24,rotation:2,opacity:0},{x:0,rotation:0,opacity:.74,duration:.42,ease:"power2.out"},9.14);
    tl.fromTo(".select-format",{y:8,opacity:0},{y:0,opacity:1,duration:.24,ease:"power2.out"},9.5);
    tl.fromTo(".voice-selected",{scale:.7,opacity:0},{scale:1,opacity:1,duration:.28,ease:"back.out(1.3)"},9.7);
    tl.to(".choice-card.voice",{scale:1.018,duration:.25,ease:"power2.out"},9.95);
    tl.to(".choice-card.voice",{scale:1,duration:.25,ease:"power2.inOut"},10.2);
    tl.to(".select-format",{scale:.95,duration:.1,yoyo:true,repeat:1,ease:"power1.inOut"},10.5);

    swap(".invite-screen",".call-screen",11.6,70,-62);
    showStory(".story-invite",".story-call",11.66,-1);
    tl.fromTo(".call-panel",{x:-24,opacity:0},{x:0,opacity:1,duration:.4,ease:"power2.out"},12.0);
    tl.fromTo(".call-copy",{x:28,opacity:0},{x:0,opacity:1,duration:.42,ease:"power2.out"},12.15);
    tl.fromTo(".phone-ring",{scale:.7,opacity:.6},{scale:1.35,opacity:0,duration:.72,ease:"power2.out"},12.48);
    tl.fromTo(".waveform i",{scaleY:.16},{scaleY:1,duration:.22,stagger:.025,repeat:3,yoyo:true,ease:"sine.inOut"},13.25);
    tl.fromTo(".call-question",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.55,ease:"power2.out"},12.58);
    tl.fromTo(".call-answer",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.72,ease:"power2.out"},13.38);

    swap(".call-screen",".review-screen",16.72,-70,58);
    showStory(".story-call",".story-review",16.78,1);
    tl.fromTo(".transcript-panel",{x:-22,opacity:0},{x:0,opacity:1,duration:.4,ease:"power2.out"},17.12);
    tl.fromTo(".transcript-answer",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.62,ease:"power2.out"},17.53);
    tl.fromTo(".summary-panel",{x:26,opacity:0},{x:0,opacity:1,duration:.42,ease:"power2.out"},17.66);
    tl.fromTo(".finding",{y:12,opacity:0},{y:0,opacity:1,duration:.27,stagger:.12,ease:"power2.out"},18.12);
    tl.fromTo(".review-decision",{y:13,opacity:0},{y:0,opacity:1,duration:.3,ease:"power2.out"},19.08);
    tl.to(".review-approve",{scale:.95,duration:.09,yoyo:true,repeat:1,ease:"power1.inOut"},19.68);

    swap(".review-screen",".calendar-screen",20.14,58,-55);
    showStory(".story-review",".story-calendar",20.2,-1);
    tl.fromTo(".calendar-intro",{y:18,opacity:0},{y:0,opacity:1,duration:.35,ease:"power2.out"},20.36);
    tl.fromTo(".calendar-panel",{scale:.95,opacity:0},{scale:1,opacity:1,duration:.38,ease:"power3.out"},20.58);
    tl.fromTo(".slot",{y:14,opacity:0},{y:0,opacity:1,duration:.29,stagger:.13,ease:"power2.out"},20.88);
    tl.fromTo(".slot-chosen",{x:12,opacity:0},{x:0,opacity:1,duration:.25,ease:"power2.out"},21.44);

    tl.to(".story-calendar",{y:-20,opacity:0,duration:.28,ease:"power1.in"},22.54);
    tl.to("#folio",{y:20,scale:.94,rotation:1.5,opacity:0,duration:.42,ease:"power2.in"},22.54);
    tl.to(".folio-shadow",{opacity:0,duration:.3,ease:"power1.in"},22.54);
    tl.fromTo(".closing",{y:30,scale:.96,opacity:0},{y:0,scale:1,opacity:1,duration:.65,ease:"power3.out"},22.72);
    tl.fromTo(".close-brand b",{rotationX:28,scale:.78},{rotationX:0,scale:1,duration:.52,ease:"back.out(1.25)"},22.95);
    tl.fromTo(".cta",{y:17,scale:.93,opacity:0},{y:0,scale:1,opacity:1,duration:.38,ease:"power2.out"},23.55);
    tl.to(".cta",{scale:1.035,duration:.35,ease:"sine.inOut",yoyo:true,repeat:1},24.15);
    tl.to({}, { duration:.001 }, 24.999);
    window.__timelines=window.__timelines||{};
    window.__timelines.main=tl;
  })();
  </script>
</div></body></html>`;

writeFileSync(resolve(out, "index.html"), html, "utf8");
console.log(`Built Smile V4 landscape composition in ${out}`);
