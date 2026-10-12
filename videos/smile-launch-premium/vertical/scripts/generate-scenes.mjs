import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const project = resolve(process.argv[2] ?? ".");
const width = Number(process.argv[3] ?? 1920);
const height = Number(process.argv[4] ?? 1080);
const portrait = height > width;

const scenes = [
  {
    id: "01-hook",
    duration: 3,
    ground: "hook-bg",
    markup: String.raw`
      <div class="hook-world">
        <div class="hook-grid"></div>
        <div class="hook-kicker">THE NEXT APPLICATION</div>
        <div class="hook-title"><span class="hook-line hook-line-one">TOO MANY</span><span class="hook-line hook-line-two">APPLICANTS?</span></div>
        <div class="hook-time">TOO LITTLE TIME<span class="hook-question">?</span></div>
        <div class="hook-stack" aria-hidden="true">
          <div class="hook-paper hook-paper-back"><i></i><b></b><em></em><em></em><em></em><em></em><em></em><strong>PROFILE</strong></div>
          <div class="hook-paper hook-paper-mid"><i></i><b></b><em></em><em></em><em></em><em></em><em></em><strong>EXPERIENCE</strong></div>
          <div class="hook-paper hook-paper-front"><i></i><b></b><em></em><em></em><em></em><em></em><em></em><div class="hook-paper-tag">APPLICATION</div></div>
          <div class="hook-file-dot">01</div>
        </div>
        <div class="hook-footer"><span class="hook-footer-mark"></span> SMILE RECRUITMENT PORTAL</div>
        <div class="hook-sweep"></div>
      </div>`,
    css: String.raw`
      #root{color:#fff}
      .hook-bg{background:radial-gradient(ellipse at 76% 42%,#1b5579 0%,#12354f 36%,#0e273b 72%,#0a1c2d 100%)}
      .hook-world{position:absolute;inset:0;transform-style:preserve-3d;overflow:hidden}
      .hook-grid{position:absolute;inset:-20%;opacity:.18;background-image:linear-gradient(115deg,transparent 0 48%,rgba(255,255,255,.16) 48.2%,transparent 48.5%),linear-gradient(25deg,transparent 0 72%,rgba(255,255,255,.11) 72.2%,transparent 72.45%);background-size:240px 180px,320px 240px;mask-image:linear-gradient(90deg,transparent,#000 40%,#000)}
      .hook-kicker{position:absolute;left:6.5%;top:15%;color:#afc7d8;font-size:clamp(14px,1.1vw,22px);font-weight:700;letter-spacing:.23em}
      .hook-title{position:absolute;left:6%;top:28%;width:51%;z-index:4;font-size:clamp(78px,8.25vw,166px);font-weight:800;letter-spacing:-.09em;line-height:.86}
      .hook-line{display:block;white-space:nowrap}
      .hook-line-one{color:#fff}
      .hook-line-two{color:#f7cf00}
      .hook-time{position:absolute;left:6.4%;top:69%;font-size:clamp(26px,2.35vw,48px);font-weight:800;letter-spacing:-.04em;color:#fff;z-index:5}
      .hook-question{color:#f7cf00}
      .hook-stack{position:absolute;right:9%;top:14%;width:35%;height:73%;perspective:1300px;transform-style:preserve-3d;z-index:3}
      .hook-paper{position:absolute;inset:4% 8% 2% 8%;border-radius:22px;background:#fdfefe;box-shadow:0 36px 95px rgba(0,0,0,.28);padding:8% 8%;color:#172033;backface-visibility:hidden}
      .hook-paper-back{opacity:.48}
      .hook-paper-mid{opacity:.72}
      .hook-paper-front{}
      .hook-paper i{display:block;width:18%;height:12%;border-radius:50%;background:#dbe8f0;margin-bottom:8%}
      .hook-paper b{display:block;width:67%;height:13px;border-radius:12px;background:#174b70;margin-bottom:7%}
      .hook-paper em{display:block;width:100%;height:8px;border-radius:8px;background:#e5eaf0;margin:5% 0}
      .hook-paper em:nth-of-type(2n){width:78%}
      .hook-paper strong{display:block;margin-top:16%;font-size:14px;letter-spacing:.15em;color:#617287}
      .hook-paper-tag{position:absolute;right:8%;bottom:8%;padding:11px 16px;border-radius:999px;background:#f7cf00;color:#0e4471;font-size:13px;font-weight:800;letter-spacing:.1em}
      .hook-file-dot{position:absolute;right:2%;bottom:2%;display:grid;place-items:center;width:90px;height:90px;border:1px solid rgba(247,207,0,.65);border-radius:50%;background:#f7cf00;color:#0e4471;font-size:28px;font-weight:800;box-shadow:0 12px 36px rgba(247,207,0,.25)}
      .hook-footer{position:absolute;left:6.5%;bottom:18%;display:flex;align-items:center;gap:13px;color:#d5e6f0;font-size:14px;font-weight:700;letter-spacing:.16em;z-index:6}
      .hook-footer-mark{width:22px;height:22px;border-radius:50%;background:#0071f7;box-shadow:12px 0 0 -4px #f7cf00}
      .hook-sweep{position:absolute;top:-20%;left:-45%;width:20%;height:150%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);transform:skewX(-16deg);pointer-events:none}
      @media (orientation:portrait){.hook-kicker{left:7%;top:11%;font-size:18px}.hook-title{left:7%;top:20%;width:88%;font-size:clamp(75px,11vw,126px)}.hook-time{left:7.5%;top:44%;font-size:clamp(27px,4.1vw,44px)}.hook-stack{left:13%;right:auto;top:53%;width:78%;height:38%}.hook-paper{inset:2% 10% 2% 10%;padding:7%}.hook-paper i{width:15%;height:14%}.hook-paper strong{margin-top:8%}.hook-file-dot{width:76px;height:76px}.hook-footer{left:7%;bottom:48%;font-size:13px}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.hook-paper-back'),{x:460,y:110,z:-70,rotation:16,scale:.78,opacity:0},{x:0,y:0,z:-70,rotation:10,scale:1,opacity:.48,duration:.72,ease:'power3.out'},0);
      tl.fromTo(q('.hook-paper-mid'),{x:370,y:85,z:-28,rotation:14,scale:.8,opacity:0},{x:0,y:0,z:-28,rotation:4,scale:1,opacity:.72,duration:.62,ease:'power3.out'},.09);
      tl.fromTo(q('.hook-paper-front'),{x:300,y:130,z:20,rotation:19,scale:.74,opacity:0},{x:0,y:0,z:20,rotation:-3,scale:1,opacity:1,duration:.72,ease:'power3.out'},.16);
      tl.fromTo(q('.hook-line-one'),{x:-180,filter:'blur(14px)',opacity:0},{x:0,filter:'blur(0px)',opacity:1,duration:.55,ease:'power4.out'},.16);
      tl.fromTo(q('.hook-line-two'),{x:190,filter:'blur(14px)',opacity:0},{x:0,filter:'blur(0px)',opacity:1,duration:.54,ease:'power4.out'},.48);
      tl.fromTo(q('.hook-time'),{y:52,scale:.9,opacity:0},{y:0,scale:1,opacity:1,duration:.48,ease:'back.out(1.2)'},1.6);
      tl.fromTo(q('.hook-file-dot'),{scale:0,rotation:-60},{scale:1,rotation:0,duration:.5,ease:'back.out(1.5)'},1.95);
      tl.to(q('.hook-stack'),{scale:1.055,x:-12,y:8,duration:2.35,ease:'power1.inOut'},.25);
      tl.to(q('.hook-sweep'),{x:width*2.4,duration:1.1,ease:'power3.inOut'},.18);
      tl.to(q('.hook-file-dot'),{scale:1.08,duration:.22,ease:'power2.out'},2.28);
      tl.to(q('.hook-file-dot'),{scale:1,duration:.24,ease:'power2.inOut'},2.5);`,
  },
  {
    id: "02-reveal",
    duration: 3,
    ground: "reveal-bg",
    markup: String.raw`
      <div class="reveal-world">
        <div class="reveal-left">
          <div class="reveal-kicker"><span></span> RECRUITMENT, CONNECTED</div>
          <h1 class="reveal-title">Meet<br><em>Smile.</em></h1>
          <div class="reveal-brandline"><img src="assets/smile-recruitment-portal-logo.png" alt="Smile mark"><strong>Smile Recruitment Portal</strong></div>
          <div class="reveal-caption">From first application<br>to human review.</div>
        </div>
        <div class="reveal-panel">
          <img src="assets/screening-panel.png" alt="Illustrative Smile Portal Resume Screening interface">
          <div class="reveal-demo">ILLUSTRATIVE UI · DEMO DATA</div>
          <div class="reveal-focus"></div>
          <div class="reveal-cursor"><span></span></div>
          <div class="reveal-edge"></div>
        </div>
        <div class="reveal-thread"></div>
      </div>`,
    css: String.raw`
      #root{color:#172033}
      .reveal-bg{background:radial-gradient(ellipse at 74% 48%,#e6f2fb 0%,#f4f7fb 49%,#fff 100%)}
      .reveal-world{position:absolute;inset:0;overflow:hidden}
      .reveal-left{position:absolute;left:7%;top:19%;width:34%;z-index:3}
      .reveal-kicker{display:flex;align-items:center;gap:12px;color:#0071f7;font-size:clamp(13px,1vw,19px);font-weight:800;letter-spacing:.15em}
      .reveal-kicker span{width:31px;height:3px;background:#f7cf00}
      .reveal-title{margin:36px 0 25px;font-size:clamp(82px,8.7vw,158px);font-weight:800;line-height:.84;letter-spacing:-.095em;color:#0e4471}
      .reveal-title em{font-style:normal;color:#0071f7}
      .reveal-brandline{display:flex;align-items:center;gap:18px;margin-top:35px;font-size:clamp(18px,1.5vw,27px);color:#0e4471}
      .reveal-brandline img{width:64px;height:64px;object-fit:contain}
      .reveal-caption{margin:28px 0 0 83px;color:#617287;font-size:clamp(16px,1.35vw,24px);line-height:1.38}
      .reveal-panel{position:absolute;left:43%;top:12%;width:53%;height:76%;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 34px 85px rgba(14,68,113,.2);transform-style:preserve-3d;border:1px solid #dfe7f1}
      .reveal-panel img{width:100%;height:100%;object-fit:cover;display:block}
      .reveal-demo{position:absolute;right:18px;top:16px;padding:10px 13px;border:1px solid #f0d768;border-radius:8px;background:#fff8ce;color:#685800;font-size:12px;font-weight:800;letter-spacing:.08em}
      .reveal-focus{position:absolute;left:20%;top:19%;width:44%;height:8%;border:2px solid rgba(0,113,247,.8);border-radius:12px;box-shadow:0 0 0 10px rgba(0,113,247,.08)}
      .reveal-cursor{position:absolute;left:55%;top:31%;width:34px;height:42px;filter:drop-shadow(0 4px 4px rgba(0,0,0,.22))}
      .reveal-cursor:before{content:'';position:absolute;inset:0;background:#0071f7;clip-path:polygon(0 0,100% 65%,58% 70%,77% 100%,62% 107%,44% 77%,20% 100%)}
      .reveal-cursor span{position:absolute;right:-18px;top:-15px;width:14px;height:14px;border-radius:50%;background:#f7cf00;box-shadow:0 0 0 7px rgba(247,207,0,.28)}
      .reveal-edge{position:absolute;left:0;top:0;bottom:0;width:8px;background:linear-gradient(#0e4471 0 34%,#0071f7 34% 78%,#f7cf00 78%)}
      .reveal-thread{position:absolute;left:39%;top:53%;width:8%;height:3px;background:#f7cf00;transform:rotate(-8deg);transform-origin:left center}
      @media (orientation:portrait){.reveal-left{left:7%;top:8%;width:86%}.reveal-kicker{font-size:15px}.reveal-title{margin:22px 0 15px;font-size:clamp(72px,10vw,100px);line-height:.84}.reveal-brandline{margin-top:18px;font-size:21px}.reveal-brandline img{width:50px;height:50px}.reveal-caption{margin:15px 0 0 66px;font-size:18px}.reveal-panel{left:7%;top:48%;width:86%;height:37%;border-radius:20px}.reveal-demo{right:10px;top:10px;font-size:10px}.reveal-focus{top:19%;height:8%}.reveal-cursor{transform:scale(.8)}.reveal-thread{left:48%;top:46%;width:6%}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.reveal-panel'),{x:330,y:90,rotationY:-17,rotationZ:1.2,scale:.86,opacity:0},{x:0,y:0,rotationY:0,rotationZ:0,scale:1,opacity:1,duration:.82,ease:'power3.out'},.18);
      tl.fromTo(q('.reveal-kicker'),{x:-70,opacity:0},{x:0,opacity:1,duration:.5,ease:'power3.out'},.28);
      tl.fromTo(q('.reveal-title'),{y:55,filter:'blur(10px)',opacity:0},{y:0,filter:'blur(0px)',opacity:1,duration:.65,ease:'power3.out'},.62);
      tl.fromTo(q('.reveal-brandline'),{y:30,opacity:0},{y:0,opacity:1,duration:.45,ease:'power3.out'},1.35);
      tl.fromTo(q('.reveal-caption'),{y:22,opacity:0},{y:0,opacity:1,duration:.42,ease:'power3.out'},1.82);
      tl.fromTo(q('.reveal-focus'),{scaleX:.04,transformOrigin:'left center',opacity:0},{scaleX:1,opacity:1,duration:.54,ease:'power2.out'},1.1);
      tl.fromTo(q('.reveal-cursor'),{x:-40,y:-20,opacity:0},{x:0,y:0,opacity:1,duration:.35,ease:'power3.out'},1.55);
      tl.to(q('.reveal-thread'),{scaleX:1.8,opacity:.8,duration:.65,ease:'power2.out'},1.25);
      tl.to(q('.reveal-panel'),{x:-10,scale:1.025,duration:1.2,ease:'power1.inOut'},1.75);`,
  },
  {
    id: "03-screening",
    duration: 4,
    ground: "screen-bg",
    markup: String.raw`
      <div class="screen-world">
        <div class="screen-copy"><div class="screen-kicker">RESUME SCREENING</div><h1>Screen<br><em>with AI.</em></h1><div class="screen-sub">Match scores.<br>Strengths. Gaps. Evidence.</div><div class="screen-disclaimer">AI-assisted insights for HR review.</div></div>
        <div class="screen-window"><img src="assets/screening-panel.png" alt="Smile Portal Resume Screening interface — illustrative demo"><div class="screen-watermark">ILLUSTRATIVE UI · DEMO DATA</div><div class="screen-laser"></div><div class="screen-drop-outline"></div><div class="screen-result"><span>AI MATCH</span><strong>82<small>%</small></strong><i>DEMO SCORE</i></div><div class="screen-cursor"></div></div>
        <div class="screen-stamp">01 / REVIEW</div>
      </div>`,
    css: String.raw`
      #root{color:#172033}
      .screen-bg{background:linear-gradient(135deg,#f4f7fb,#eef4fa 62%,#e2edf8)}
      .screen-world{position:absolute;inset:0;overflow:hidden}
      .screen-copy{position:absolute;left:6.5%;top:17%;width:26%;z-index:4}
      .screen-kicker{color:#006bea;font-size:clamp(13px,1vw,18px);font-weight:800;letter-spacing:.15em}
      .screen-copy h1{margin:30px 0 24px;font-size:clamp(78px,7vw,132px);line-height:.86;letter-spacing:-.09em;color:#0e4471;font-weight:800}
      .screen-copy h1 em{font-style:normal;color:#0071f7}
      .screen-sub{font-size:clamp(19px,1.65vw,30px);line-height:1.28;font-weight:650;color:#172033}
      .screen-disclaimer{margin-top:27px;padding-left:13px;border-left:3px solid #f7cf00;color:#617287;font-size:clamp(14px,1.1vw,19px);line-height:1.4}
      .screen-window{position:absolute;left:35%;top:9%;width:62%;height:82%;overflow:hidden;border:1px solid #dfe7f1;border-radius:20px;background:#fff;box-shadow:0 28px 80px rgba(14,68,113,.16);transform-style:preserve-3d}
      .screen-window img{display:block;width:100%;height:100%;object-fit:cover}
      .screen-watermark{position:absolute;right:16px;top:14px;padding:9px 12px;border:1px solid #f0d768;border-radius:7px;background:#fff8ce;color:#685800;font-size:11px;font-weight:850;letter-spacing:.08em}
      .screen-laser{position:absolute;left:17%;top:35%;width:80%;height:2px;background:linear-gradient(90deg,transparent,#0071f7,#f7cf00,transparent);box-shadow:0 0 18px rgba(0,113,247,.75);transform:scaleX(0);transform-origin:left center}
      .screen-drop-outline{position:absolute;left:17%;top:24%;width:80%;height:19%;border:2px solid rgba(0,113,247,.72);border-radius:13px;box-shadow:0 0 0 8px rgba(0,113,247,.06);transform:scaleX(.02);transform-origin:left center}
      .screen-result{position:absolute;left:61%;top:60%;width:190px;padding:15px 18px;border-radius:14px;background:#0e4471;color:#fff;box-shadow:0 18px 40px rgba(14,68,113,.28);display:flex;flex-direction:column;align-items:flex-start}
      .screen-result span{font-size:10px;letter-spacing:.13em;font-weight:800;color:#d5edff}.screen-result strong{font-size:47px;line-height:1.05;letter-spacing:-.06em}.screen-result small{font-size:22px}.screen-result i{font-style:normal;font-size:9px;letter-spacing:.15em;color:#f7cf00;font-weight:800}
      .screen-cursor{position:absolute;left:50%;top:47%;width:28px;height:38px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.3))}.screen-cursor:before{content:'';position:absolute;inset:0;background:#0071f7;clip-path:polygon(0 0,100% 64%,57% 70%,78% 100%,62% 106%,44% 76%,20% 100%)}
      .screen-stamp{position:absolute;right:4%;bottom:18%;font-size:12px;font-weight:800;letter-spacing:.16em;color:#8d9bad}
      @media (orientation:portrait){.screen-copy{left:7%;top:7%;width:86%}.screen-kicker{font-size:16px}.screen-copy h1{margin:18px 0 15px;font-size:clamp(70px,10vw,100px)}.screen-sub{font-size:22px;line-height:1.18}.screen-disclaimer{margin-top:13px;font-size:15px}.screen-window{left:5%;top:37%;width:90%;height:45%;border-radius:18px}.screen-watermark{font-size:10px;right:8px;top:8px}.screen-result{left:59%;top:65%;width:150px;padding:10px 12px}.screen-result strong{font-size:35px}.screen-result span{font-size:8px}.screen-result i{font-size:7px}.screen-stamp{right:7%;bottom:18%;font-size:11px}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.screen-window'),{x:260,rotationY:-11,scale:.88,opacity:0},{x:0,rotationY:0,scale:1,opacity:1,duration:.72,ease:'power3.out'},.06);
      tl.fromTo(q('.screen-copy'),{x:-65,opacity:0},{x:0,opacity:1,duration:.6,ease:'power3.out'},.2);
      tl.fromTo(q('.screen-drop-outline'),{scaleX:.02},{scaleX:1,duration:.65,ease:'power3.out'},.7);
      tl.fromTo(q('.screen-laser'),{scaleX:0},{scaleX:1,duration:.58,ease:'power2.out'},1.05);
      tl.fromTo(q('.screen-result'),{y:80,scale:.78,opacity:0},{y:0,scale:1,opacity:1,duration:.56,ease:'back.out(1.25)'},2.05);
      tl.fromTo(q('.screen-cursor'),{x:-38,y:-24,opacity:0},{x:0,y:0,opacity:1,duration:.3,ease:'power3.out'},1.72);
      tl.fromTo(q('.screen-stamp'),{x:22,opacity:0},{x:0,opacity:1,duration:.4,ease:'power3.out'},2.45);
      tl.to(q('.screen-window'),{scale:1.025,x:-12,duration:1.25,ease:'power1.inOut'},2.25);`,
  },
  {
    id: "04-interviews",
    duration: 5,
    ground: "interview-bg",
    markup: String.raw`
      <div class="interview-world">
        <div class="interview-heading"><div class="interview-kicker">CANDIDATE EXPERIENCE</div><h1>Voice or<br><em>Live Avatar.</em></h1><p>One format, based on the role.</p></div>
        <div class="interview-window"><img src="assets/interview-choice-panel.png" alt="Smile Portal candidate interview choices — illustrative demo"><div class="interview-watermark">ILLUSTRATIVE UI · DEMO DATA</div><div class="interview-call-ring"></div><div class="interview-avatar-ring"></div><div class="interview-consent">CONSENT BEFORE RECORDING</div><div class="interview-choice-dot">✓</div></div>
        <div class="interview-facts"><div><b>10 min</b><span>scheduled voice call</span></div><div><b>Up to 20 min</b><span>Live Avatar interview</span></div></div>
        <div class="interview-rail"><span>VOICE</span><i></i><span>LIVE AVATAR</span></div>
      </div>`,
    css: String.raw`
      #root{color:#fff}
      .interview-bg{background:radial-gradient(ellipse at 80% 35%,#1d5273 0%,#14364f 41%,#0e273b 82%)}
      .interview-world{position:absolute;inset:0;overflow:hidden}
      .interview-heading{position:absolute;left:6.5%;top:17%;width:34%;z-index:3}
      .interview-kicker{font-size:clamp(13px,1vw,18px);font-weight:800;letter-spacing:.16em;color:#a8c9dc}
      .interview-heading h1{margin:28px 0 20px;font-size:clamp(70px,6.6vw,126px);line-height:.9;letter-spacing:-.09em;font-weight:800;color:#fff}
      .interview-heading h1 em{font-style:normal;color:#f7cf00}
      .interview-heading p{margin:0;color:#c2d5e2;font-size:clamp(18px,1.55vw,27px);line-height:1.35}
      .interview-window{position:absolute;left:42%;top:8%;width:49%;height:78%;overflow:hidden;border-radius:21px;background:#fff;box-shadow:0 38px 95px rgba(0,0,0,.28);transform-style:preserve-3d}
      .interview-window img{width:100%;height:100%;display:block;object-fit:cover}
      .interview-watermark{position:absolute;right:12px;top:12px;padding:8px 10px;border:1px solid #f0d768;border-radius:7px;background:#fff8ce;color:#685800;font-size:10px;font-weight:850;letter-spacing:.05em}
      .interview-call-ring,.interview-avatar-ring{position:absolute;top:35%;height:23%;width:41%;border:2px solid #0071f7;border-radius:16px;box-shadow:0 0 0 7px rgba(0,113,247,.09);opacity:0}
      .interview-call-ring{left:6.4%}.interview-avatar-ring{right:6.4%;border-color:#f0bf00;box-shadow:0 0 0 7px rgba(247,207,0,.13)}
      .interview-consent{position:absolute;right:8%;top:61%;padding:8px 10px;border-radius:7px;background:#fff8ce;color:#685800;font-size:9px;font-weight:900;letter-spacing:.06em;opacity:0}
      .interview-choice-dot{position:absolute;right:8%;top:42%;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#0071f7;color:#fff;font-size:18px;box-shadow:0 0 0 7px rgba(0,113,247,.15);opacity:0}
      .interview-facts{position:absolute;left:6.5%;bottom:13%;display:flex;gap:30px;color:#fff}
      .interview-facts div{display:flex;flex-direction:column;gap:6px;padding-left:14px;border-left:3px solid #f7cf00}
      .interview-facts b{font-size:clamp(18px,1.5vw,27px);letter-spacing:-.03em}.interview-facts span{font-size:clamp(13px,1vw,17px);color:#aec5d6}
      .interview-rail{position:absolute;right:8%;bottom:17%;display:flex;align-items:center;gap:12px;color:#d1e4f0;font-size:11px;font-weight:800;letter-spacing:.16em}.interview-rail i{width:50px;height:2px;background:#f7cf00}
      @media (orientation:portrait){.interview-heading{left:7%;top:6%;width:86%}.interview-kicker{font-size:15px}.interview-heading h1{margin:17px 0 12px;font-size:clamp(66px,9.7vw,96px)}.interview-heading p{font-size:19px}.interview-window{left:6%;top:36%;width:88%;height:39%;border-radius:18px}.interview-watermark{right:8px;top:8px;font-size:9px}.interview-facts{left:8%;bottom:19%;gap:20px}.interview-facts b{font-size:21px}.interview-facts span{font-size:13px}.interview-rail{right:8%;bottom:20%;font-size:9px}.interview-rail i{width:30px}.interview-call-ring,.interview-avatar-ring{top:36%;height:22%}.interview-consent{top:62%;font-size:8px}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.interview-window'),{x:280,rotationY:-12,scale:.88,opacity:0},{x:0,rotationY:0,scale:1,opacity:1,duration:.8,ease:'power3.out'},.12);
      tl.fromTo(q('.interview-heading'),{x:-55,opacity:0},{x:0,opacity:1,duration:.55,ease:'power3.out'},.2);
      tl.fromTo(q('.interview-call-ring'),{x:-55,rotationY:-20,opacity:0},{x:0,rotationY:0,opacity:1,duration:.5,ease:'power3.out'},1.05);
      tl.to(q('.interview-call-ring'),{scale:1.025,boxShadow:'0 0 0 13px rgba(0,113,247,.13)',duration:.42,yoyo:true,repeat:1,ease:'sine.inOut'},1.62);
      tl.fromTo(q('.interview-avatar-ring'),{x:65,rotationY:20,opacity:0},{x:0,rotationY:0,opacity:1,duration:.5,ease:'power3.out'},2.34);
      tl.fromTo(q('.interview-consent'),{y:12,opacity:0},{y:0,opacity:1,duration:.32,ease:'power2.out'},3.04);
      tl.fromTo(q('.interview-choice-dot'),{scale:0},{scale:1,opacity:1,duration:.32,ease:'back.out(1.5)'},3.55);
      tl.fromTo(q('.interview-facts'),{y:25,opacity:0},{y:0,opacity:1,duration:.45,ease:'power3.out'},3.78);
      tl.fromTo(q('.interview-rail'),{x:25,opacity:0},{x:0,opacity:1,duration:.35,ease:'power3.out'},4.25);`,
  },
  {
    id: "05-review",
    duration: 4,
    ground: "review-bg",
    markup: String.raw`
      <div class="review-world">
        <div class="review-copy"><div class="review-kicker">EVIDENCE FOR HR</div><h1>More context.<br><em>Better review.</em></h1><div class="review-rule"></div><div class="review-truth"><span></span><strong>AI supports review.<br>HR makes the decision.</strong></div></div>
        <div class="review-window"><img src="assets/evidence-review-panel.png" alt="Smile Portal Applicant Review interface — illustrative demo"><div class="review-watermark">ILLUSTRATIVE UI · DEMO DATA</div><div class="review-focus"></div><div class="review-cursor"></div><div class="review-evidence-tag">SCREENING + INTERVIEW EVIDENCE</div></div>
        <div class="review-connector"></div>
      </div>`,
    css: String.raw`
      #root{color:#172033}
      .review-bg{background:linear-gradient(105deg,#fdfefe,#f4f7fb 47%,#eaf2fa)}
      .review-world{position:absolute;inset:0;overflow:hidden}
      .review-copy{position:absolute;left:6.5%;top:20%;width:33%;z-index:3}
      .review-kicker{color:#006bea;font-size:clamp(13px,1vw,18px);font-weight:850;letter-spacing:.15em}
      .review-copy h1{margin:30px 0 30px;font-size:clamp(57px,5.2vw,100px);font-weight:800;line-height:.98;letter-spacing:-.078em;color:#0e4471}
      .review-copy h1 em{font-style:normal;color:#0071f7}
      .review-rule{width:84px;height:4px;background:#f7cf00;margin:28px 0}
      .review-truth{display:flex;align-items:flex-start;gap:16px;font-size:clamp(18px,1.45vw,27px);line-height:1.34;color:#172033}
      .review-truth span{flex:0 0 auto;width:12px;height:55px;background:#f7cf00;border-radius:6px}
      .review-window{position:absolute;left:40%;top:9%;width:57%;height:82%;overflow:hidden;border-radius:20px;background:#fff;border:1px solid #dfe7f1;box-shadow:0 28px 80px rgba(14,68,113,.16);transform-style:preserve-3d}
      .review-window img{display:block;width:100%;height:100%;object-fit:cover}
      .review-watermark{position:absolute;right:14px;top:13px;padding:8px 10px;border:1px solid #f0d768;border-radius:7px;background:#fff8ce;color:#685800;font-size:10px;font-weight:850;letter-spacing:.06em}
      .review-focus{position:absolute;left:39%;top:29%;width:48%;height:26%;border:2px solid rgba(0,113,247,.8);border-radius:12px;box-shadow:0 0 0 8px rgba(0,113,247,.08);opacity:0}
      .review-cursor{position:absolute;left:73%;top:71%;width:28px;height:37px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.25));opacity:0}.review-cursor:before{content:'';position:absolute;inset:0;background:#0071f7;clip-path:polygon(0 0,100% 64%,57% 70%,78% 100%,62% 106%,44% 76%,20% 100%)}
      .review-evidence-tag{position:absolute;left:38%;top:19%;padding:8px 10px;border-radius:6px;background:#0e4471;color:#f7cf00;font-size:10px;font-weight:850;letter-spacing:.07em;opacity:0}
      .review-connector{position:absolute;left:36%;top:48%;width:8%;height:2px;background:#f7cf00;transform-origin:left center}
      @media (orientation:portrait){.review-copy{left:7%;top:6%;width:86%}.review-kicker{font-size:15px}.review-copy h1{margin:17px 0 14px;font-size:clamp(56px,8.6vw,90px)}.review-rule{margin:15px 0;width:60px}.review-truth{font-size:18px}.review-truth span{height:45px}.review-window{left:5%;top:41%;width:90%;height:39%;border-radius:17px}.review-watermark{right:7px;top:7px;font-size:9px}.review-focus{top:29%;height:25%}.review-evidence-tag{font-size:8px;padding:6px 7px}.review-connector{display:none}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.review-window'),{x:240,scale:.89,rotationY:-10,opacity:0},{x:0,scale:1,rotationY:0,opacity:1,duration:.72,ease:'power3.out'},.05);
      tl.fromTo(q('.review-copy'),{x:-45,opacity:0},{x:0,opacity:1,duration:.52,ease:'power3.out'},.18);
      tl.fromTo(q('.review-focus'),{scale:.85,opacity:0},{scale:1,opacity:1,duration:.46,ease:'power3.out'},1.08);
      tl.fromTo(q('.review-evidence-tag'),{y:16,opacity:0},{y:0,opacity:1,duration:.38,ease:'power3.out'},1.5);
      tl.fromTo(q('.review-cursor'),{x:-16,y:-12,opacity:0},{x:0,y:0,opacity:1,duration:.28,ease:'power3.out'},2.05);
      tl.to(q('.review-window'),{scale:1.035,x:-18,duration:1.1,ease:'power1.inOut'},2.2);
      tl.fromTo(q('.review-connector'),{scaleX:.1,opacity:0},{scaleX:1,opacity:1,duration:.45,ease:'power3.out'},2.6);`,
  },
  {
    id: "06-workflow",
    duration: 3,
    ground: "flow-bg",
    markup: String.raw`
      <div class="flow-world"><div class="flow-kicker">ONE CANDIDATE JOURNEY</div><h1 class="flow-title">One connected hiring workflow.</h1><div class="flow-canvas"><svg class="flow-svg" viewBox="0 0 1920 700" preserveAspectRatio="none"><path class="flow-path" d="M160 430 C300 430 300 250 490 250 S680 250 800 430 S1030 610 1190 430 S1410 250 1580 430 S1760 540 1840 430"/></svg><div class="flow-station flow-s1"><b>01</b><strong>Role setup</strong><span>Criteria reviewed by HR</span></div><div class="flow-station flow-s2"><b>02</b><strong>Screening</strong><span>Match + evidence</span></div><div class="flow-station flow-s3"><b>03</b><strong>AI interview</strong><span>Configured format</span></div><div class="flow-station flow-s4"><b>04</b><strong>HR review</strong><span>People decide</span></div><div class="flow-station flow-s5"><b>05</b><strong>Scheduling</strong><span>When the role needs it</span></div><div class="flow-candidate"><span></span><b>APPLICANT</b></div></div></div>`,
    css: String.raw`
      #root{color:#fff}
      .flow-bg{background:radial-gradient(ellipse at 50% 60%,#1b5475 0%,#123b58 42%,#0e2d47 78%,#0b2238 100%)}
      .flow-world{position:absolute;inset:0;overflow:hidden}
      .flow-kicker{position:absolute;left:7%;top:10%;font-size:clamp(13px,1vw,18px);font-weight:850;letter-spacing:.17em;color:#aac8d9}
      .flow-title{position:absolute;left:7%;top:15%;margin:0;font-size:clamp(54px,5vw,92px);font-weight:800;letter-spacing:-.075em;line-height:.95;color:#fff;max-width:80%}
      .flow-canvas{position:absolute;inset:20% 0 10%;}
      .flow-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
      .flow-path{fill:none;stroke:#69c3ff;stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;filter:drop-shadow(0 0 10px rgba(0,113,247,.35))}
      .flow-station{position:absolute;left:0;top:0;width:250px;min-height:142px;padding:19px 20px 17px 72px;border:1px solid rgba(193,221,238,.28);border-radius:17px;background:rgba(255,255,255,.09);backdrop-filter:blur(8px);box-shadow:0 20px 42px rgba(0,0,0,.14);opacity:0}
      .flow-station b{position:absolute;left:18px;top:19px;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#f7cf00;color:#0e4471;font-size:12px;font-weight:900}
      .flow-station strong{display:block;margin:5px 0 8px;font-size:21px;letter-spacing:-.03em}.flow-station span{display:block;font-size:14px;line-height:1.25;color:#c4d9e6}
      .flow-candidate{position:absolute;left:0;top:0;display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:999px;background:#fff;color:#0e4471;font-size:10px;font-weight:900;letter-spacing:.08em;box-shadow:0 10px 28px rgba(0,0,0,.25);z-index:5}
      .flow-candidate span{width:9px;height:9px;border-radius:50%;background:#0071f7;box-shadow:0 0 0 5px rgba(0,113,247,.16)}
      @media (orientation:portrait){.flow-kicker{left:8%;top:6%;font-size:14px}.flow-title{left:8%;top:9%;max-width:86%;font-size:clamp(52px,7.6vw,78px);line-height:.96}.flow-canvas{inset:21% 0 8%}.flow-svg{inset:0;width:100%;height:100%}.flow-station{width:42%;min-height:132px;padding:17px 12px 15px 58px;border-radius:16px}.flow-station b{width:34px;height:34px;left:12px;top:17px}.flow-station strong{font-size:18px}.flow-station span{font-size:13px}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      const svg=q('.flow-path');const pathLen=svg.getTotalLength();svg.style.strokeDasharray=pathLen;svg.style.strokeDashoffset=pathLen;
      const p=portrait?[[width*.5,height*.22],[width*.5,height*.35],[width*.5,height*.48],[width*.5,height*.61],[width*.5,height*.74]]:[[width*.12,height*.62],[width*.255,height*.35],[width*.42,height*.62],[width*.62,height*.35],[width*.82,height*.62]];
      const cardP=portrait?[[width*.26,height*.25],[width*.74,height*.38],[width*.26,height*.51],[width*.74,height*.64],[width*.26,height*.77]]:[[width*.12,height*.44],[width*.255,height*.33],[width*.42,height*.44],[width*.62,height*.33],[width*.82,height*.44]];
      const cards=[...root.querySelectorAll('.flow-station')];
      const svgEl=q('.flow-svg');svgEl.setAttribute('viewBox','0 0 '+width+' '+(height*.68));svgEl.setAttribute('preserveAspectRatio','none');
      const local=p.map(([x,y])=>[x,y-height*.2]);
      const d='M'+local[0][0]+' '+local[0][1]+' C'+(local[0][0]+width*.08)+' '+local[0][1]+','+(local[1][0]-width*.08)+' '+local[1][1]+','+local[1][0]+' '+local[1][1]+' S'+(local[2][0]-width*.08)+' '+local[2][1]+','+local[2][0]+' '+local[2][1]+' S'+(local[3][0]-width*.08)+' '+local[3][1]+','+local[3][0]+' '+local[3][1]+' S'+(local[4][0]-width*.08)+' '+local[4][1]+','+local[4][0]+' '+local[4][1];svg.setAttribute('d',d);const len=svg.getTotalLength();svg.style.strokeDasharray=len;svg.style.strokeDashoffset=len;
      cards.forEach((el,i)=>{gsap.set(el,{xPercent:-50,yPercent:-50,x:cardP[i][0],y:cardP[i][1]-height*.2});});gsap.set(q('.flow-candidate'),{xPercent:-50,yPercent:-50,x:p[0][0],y:p[0][1]-height*.2});
      tl.to(svg,{strokeDashoffset:0,duration:2.15,ease:'power2.inOut'},.18);
      cards.forEach((el,i)=>tl.fromTo(el,{scale:.82,opacity:0},{scale:1,opacity:1,duration:.34,ease:'power3.out'},.22+i*.36));
      for(let i=1;i<p.length;i++)tl.to(q('.flow-candidate'),{x:p[i][0],y:p[i][1]-height*.2,duration:.38,ease:'power2.inOut'},.45+(i-1)*.4);
      `,
  },
  {
    id: "07-close",
    duration: 3,
    ground: "close-bg",
    markup: String.raw`
      <div class="close-world"><div class="close-orbit close-orbit-one"></div><div class="close-orbit close-orbit-two"></div><div class="close-lockup"><img class="close-logo" src="assets/smile-recruitment-portal-logo.png" alt="Smile Recruitment Portal logo"><div class="close-name">Smile Recruitment Portal</div><h1>Smarter recruitment<br><em>starts with Smile.</em></h1><div class="close-cta"><span>Try Smile now</span><b>→</b></div><div class="close-foot">AI-assisted workflow · Human-led decisions</div></div><div class="close-spark close-spark-one"></div><div class="close-spark close-spark-two"></div><div class="close-spark close-spark-three"></div></div>`,
    css: String.raw`
      #root{color:#172033}
      .close-bg{background:radial-gradient(ellipse at 50% 48%,#fff 0%,#f4f7fb 56%,#e6f0f9 100%)}
      .close-world{position:absolute;inset:0;overflow:hidden;display:grid;place-items:center}
      .close-lockup{position:relative;display:flex;flex-direction:column;align-items:center;z-index:2;text-align:center}
      .close-logo{width:128px;height:128px;object-fit:contain;filter:drop-shadow(0 12px 26px rgba(14,68,113,.12))}
      .close-name{margin-top:10px;color:#0e4471;font-size:clamp(16px,1.35vw,23px);font-weight:800;letter-spacing:-.02em}
      .close-lockup h1{margin:24px 0 27px;font-size:clamp(59px,5.6vw,108px);line-height:.96;font-weight:800;letter-spacing:-.085em;color:#0e4471}
      .close-lockup h1 em{font-style:normal;color:#0071f7}
      .close-cta{display:flex;align-items:center;gap:25px;padding:18px 21px 18px 34px;border-radius:999px;background:#0071f7;color:#fff;box-shadow:0 15px 34px rgba(0,113,247,.24);font-size:clamp(22px,1.8vw,33px);font-weight:800;letter-spacing:-.03em}
      .close-cta b{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:#f7cf00;color:#0e4471;font-size:27px}
      .close-foot{margin-top:22px;color:#617287;font-size:clamp(13px,1vw,17px);font-weight:650;letter-spacing:.02em}
      .close-orbit{position:absolute;left:50%;top:48%;border:1px solid rgba(0,113,247,.14);border-radius:50%}
      .close-orbit-one{width:780px;height:780px;margin-left:-390px;margin-top:-390px}.close-orbit-two{width:1020px;height:1020px;margin-left:-510px;margin-top:-510px;border-color:rgba(247,207,0,.24)}
      .close-spark{position:absolute;width:14px;height:14px;border-radius:50%;background:#f7cf00;box-shadow:0 0 0 8px rgba(247,207,0,.16)}
      .close-spark-one{left:26%;top:29%}.close-spark-two{right:23%;top:38%;width:10px;height:10px;background:#0071f7;box-shadow:0 0 0 7px rgba(0,113,247,.13)}.close-spark-three{left:33%;bottom:22%;width:9px;height:9px}
      @media (orientation:portrait){.close-logo{width:130px;height:130px}.close-name{font-size:20px}.close-lockup h1{margin:23px 0 25px;font-size:clamp(54px,8.5vw,84px)}.close-cta{padding:17px 18px 17px 29px;font-size:25px;gap:21px}.close-cta b{width:43px;height:43px}.close-foot{font-size:14px}.close-orbit-one{width:760px;height:760px;margin-left:-380px;margin-top:-380px}.close-orbit-two{width:960px;height:960px;margin-left:-480px;margin-top:-480px}.close-spark-one{left:12%;top:27%}.close-spark-two{right:12%;top:36%}.close-spark-three{left:18%;bottom:24%}}
    `,
    js: String.raw`
      const q=s=>root.querySelector(s);
      tl.fromTo(q('.close-orbit-one'),{scale:.72,opacity:0,rotation:-22},{scale:1,opacity:1,rotation:0,duration:.85,ease:'power3.out'},.06);
      tl.fromTo(q('.close-orbit-two'),{scale:.78,opacity:0,rotation:18},{scale:1,opacity:1,rotation:0,duration:.9,ease:'power3.out'},.1);
      tl.fromTo(q('.close-logo'),{scale:.48,rotation:-12,opacity:0},{scale:1,rotation:0,opacity:1,duration:.7,ease:'back.out(1.2)'},.18);
      tl.fromTo(q('.close-name'),{y:18,opacity:0},{y:0,opacity:1,duration:.35,ease:'power3.out'},.74);
      tl.fromTo(q('.close-lockup h1'),{y:36,filter:'blur(8px)',opacity:0},{y:0,filter:'blur(0px)',opacity:1,duration:.58,ease:'power3.out'},1.0);
      tl.fromTo(q('.close-cta'),{y:30,scale:.84,opacity:0},{y:0,scale:1,opacity:1,duration:.48,ease:'back.out(1.15)'},1.78);
      tl.fromTo(q('.close-foot'),{y:14,opacity:0},{y:0,opacity:1,duration:.38,ease:'power3.out'},2.2);
      tl.to(q('.close-cta'),{scale:1.035,duration:.24,ease:'power2.out'},2.28);
      tl.to(q('.close-cta'),{scale:1,duration:.28,ease:'power2.inOut'},2.52);
      tl.to(q('.close-spark-one'),{x:14,y:-9,duration:1.4,ease:'sine.inOut'},.9);
      tl.to(q('.close-spark-two'),{x:-12,y:13,duration:1.2,ease:'sine.inOut'},1.15);`,
  },
];

const commonStyle = (scene, w, h) => `@font-face{font-family:Manrope;src:url("assets/fonts/captured-Manrope.ttf") format("truetype");font-weight:400 800;font-display:block}*{box-sizing:border-box}#root{position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:Manrope,Arial,sans-serif;font-synthesis:none}#root *{box-sizing:border-box}.clip{position:absolute;inset:0;width:100%;height:100%}.${scene.id}-ground{z-index:0}`;

function documentFor(scene, w, h) {
  const css = `${commonStyle(scene, w, h)}\n${scene.css}`;
  return `<template><style>${css}</style><div id="root" data-composition-id="${scene.id}" data-width="${w}" data-height="${h}"><div id="ground-${scene.id}" class="${scene.id}-ground ${scene.ground} clip" data-start="0" data-duration="${scene.duration}" data-track-index="0"></div>${scene.markup}</div><script>(()=>{const root=document.querySelector('[data-composition-id="${scene.id}"]');if(!root||!window.gsap)return;window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});window.__timelines["${scene.id}"]=tl;const width=${w},height=${h},portrait=${portrait};${scene.js}tl.seek(0)})();</script></template>`;
}

const frameDir = resolve(project, "compositions/frames");
mkdirSync(frameDir, { recursive: true });
for (const scene of scenes) {
  const path = resolve(frameDir, `${scene.id}.html`);
  writeFileSync(path, documentFor(scene, width, height), "utf8");
  console.log(`${scene.id}: ${width}×${height} → ${path}`);
}
