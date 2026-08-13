import type {CSSProperties, FC, ReactNode} from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import {BRAND, BrandLockup, FONT, PeopleOSMark} from "./brand";
import type {DayMoment, PeopleOSAdConfig, SceneWindow} from "./config";
import {DayIcon, MessageIcon, PhoneIcon} from "./icons";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const
};

const secondsToFrames = (seconds: number, fps: number) => Math.round(seconds * fps);

const enter = (frame: number, fps: number, delay = 0, duration = 0.42) =>
  interpolate(frame, [secondsToFrames(delay, fps), secondsToFrames(delay + duration, fps)], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic)
  });

const sceneOpacity = (frame: number, duration: number, fadeFrames = 7, fadeOut = true) =>
  fadeOut
    ? interpolate(frame, [0, fadeFrames, Math.max(fadeFrames, duration - fadeFrames), duration], [0, 1, 1, 0], clamp)
    : interpolate(frame, [0, fadeFrames], [0, 1], clamp);

const splitLines = (text: string) => text.split("\n");

const AccentOrb: FC<{style?: CSSProperties}> = ({style}) => (
  <div
    style={{
      position: "absolute",
      width: 560,
      height: 560,
      borderRadius: "50%",
      background: BRAND.blushStrong,
      filter: "blur(1px)",
      ...style
    }}
  />
);

const SafeFrame: FC<{children: ReactNode; style?: CSSProperties}> = ({children, style}) => (
  <AbsoluteFill style={{padding: "166px 92px 288px", ...style}}>{children}</AbsoluteFill>
);

const Scene: FC<{
  window: SceneWindow;
  children: ReactNode;
  fadeFrames?: number;
  fadeOut?: boolean;
}> = ({window, children, fadeFrames = 7, fadeOut = true}) => {
  const {fps} = useVideoConfig();
  const from = secondsToFrames(window.start, fps);
  const duration = secondsToFrames(window.end - window.start, fps);
  return (
    <Sequence from={from} durationInFrames={duration} premountFor={fps}>
      <SceneFade duration={duration} fadeFrames={fadeFrames} fadeOut={fadeOut}>{children}</SceneFade>
    </Sequence>
  );
};

const SceneFade: FC<{children: ReactNode; duration: number; fadeFrames: number; fadeOut: boolean}> = ({children, duration, fadeFrames, fadeOut}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: sceneOpacity(frame, duration, fadeFrames, fadeOut)}}>{children}</AbsoluteFill>;
};

const OpeningScene: FC<{text: string}> = ({text}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = spring({frame: frame - 2, fps, config: {damping: 18, stiffness: 120, mass: 0.8}});
  const underline = enter(frame, fps, 0.46, 0.45);
  const orbShift = interpolate(frame, [0, fps * 1.6], [0, 70], clamp);

  return (
    <AbsoluteFill style={{background: BRAND.warmPaper, color: BRAND.ink}}>
      <AccentOrb style={{right: -260 + orbShift, top: 350, opacity: 0.84}} />
      <AccentOrb style={{left: -370, bottom: -160, width: 720, height: 720, background: "#f7e7d5", opacity: 0.58}} />
      <SafeFrame style={{justifyContent: "center"}}>
        <BrandLockup style={{position: "absolute", top: 166, left: 92}} />
        <div
          style={{
            position: "relative",
            width: 850,
            transform: `translateY(${(1 - reveal) * 52}px) scale(${0.96 + reveal * 0.04})`,
            opacity: reveal
          }}
        >
          <h1
            style={{
              margin: 0,
              maxWidth: 840,
              fontFamily: FONT.display,
              fontSize: 145,
              fontWeight: 500,
              lineHeight: 0.94,
              letterSpacing: "-0.06em"
            }}
          >
            {text}
          </h1>
          <div
            style={{
              width: 475 * underline,
              height: 17,
              marginTop: 32,
              marginLeft: 6,
              borderRadius: 999,
              background: BRAND.berry,
              transform: `rotate(-1.5deg) scaleX(${underline})`,
              transformOrigin: "left center"
            }}
          />
        </div>
      </SafeFrame>
    </AbsoluteFill>
  );
};

const GuiltScene: FC<{lead: string; action: string; emphasis: string}> = ({lead, action, emphasis}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const leadIn = enter(frame, fps, 0.02, 0.28);
  const actionIn = enter(frame, fps, 0.18, 0.34);
  const emphasisIn = spring({frame: frame - secondsToFrames(0.48, fps), fps, config: {damping: 12, stiffness: 165}});
  const bubbleIn = enter(frame, fps, 0.72, 0.4);

  return (
    <AbsoluteFill style={{background: BRAND.paper, color: BRAND.ink}}>
      <div style={{position: "absolute", inset: 0, background: `linear-gradient(150deg, ${BRAND.paper} 38%, ${BRAND.blush} 100%)`}} />
      <SafeFrame style={{justifyContent: "center"}}>
        <div style={{position: "relative", zIndex: 2}}>
          <div
            style={{
              fontFamily: FONT.interface,
              fontSize: 74,
              fontWeight: 720,
              letterSpacing: "-0.045em",
              opacity: leadIn,
              transform: `translateY(${(1 - leadIn) * 28}px)`
            }}
          >
            {lead}
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT.display,
              fontSize: 150,
              fontWeight: 500,
              lineHeight: 0.92,
              letterSpacing: "-0.065em",
              opacity: actionIn,
              transform: `translateY(${(1 - actionIn) * 36}px)`
            }}
          >
            {action}
          </div>
          <div
            style={{
              width: "fit-content",
              marginTop: 28,
              padding: "18px 32px 16px",
              color: BRAND.paper,
              background: BRAND.berry,
              borderRadius: 24,
              fontFamily: FONT.interface,
              fontSize: 112,
              fontWeight: 880,
              lineHeight: 0.95,
              letterSpacing: "-0.065em",
              transform: `rotate(-2deg) scale(${0.78 + emphasisIn * 0.22})`,
              opacity: emphasisIn
            }}
          >
            {emphasis}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 76,
            bottom: 300,
            width: 220,
            height: 160,
            border: `4px solid ${BRAND.blushStrong}`,
            borderRadius: 44,
            opacity: bubbleIn,
            transform: `translate(${(1 - bubbleIn) * 80}px, ${(1 - bubbleIn) * 30}px) rotate(7deg)`
          }}
        >
          <div style={{position: "absolute", left: 42, top: 45, width: 132, height: 10, borderRadius: 999, background: BRAND.blushStrong}} />
          <div style={{position: "absolute", left: 42, top: 80, width: 82, height: 10, borderRadius: 999, background: BRAND.blushStrong}} />
        </div>
      </SafeFrame>
    </AbsoluteFill>
  );
};

const DayMomentCard: FC<{moment: DayMoment; index: number; slotFrames: number}> = ({moment, index, slotFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const start = index * slotFrames;
  const local = frame - start;
  const inProgress = interpolate(local, [0, 7], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const outProgress = interpolate(local, [slotFrames + 6, slotFrames + 14], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const scale = 0.94 + inProgress * 0.06;
  const top = 575 + (1 - inProgress) * 160 - outProgress * 160;
  const last = moment.kind === "late";

  return (
    <div
      style={{
        position: "absolute",
        left: 92,
        right: 92,
        top,
        minHeight: last ? 460 : 390,
        padding: last ? "62px 64px" : "54px 58px",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 44,
        alignItems: "center",
        color: last ? BRAND.paper : BRAND.ink,
        background: last ? BRAND.berryDark : BRAND.paper,
        border: last ? 0 : `1px solid ${BRAND.line}`,
        borderRadius: 48,
        boxShadow: "0 38px 90px rgba(62, 31, 42, 0.15), 0 8px 24px rgba(62, 31, 42, 0.07)",
        opacity: inProgress * (1 - outProgress),
        transform: `scale(${scale}) rotate(${(1 - inProgress) * 1.8 - outProgress * 1.2}deg)`,
        zIndex: index + 1
      }}
    >
      <div
        style={{
          width: 155,
          height: 155,
          display: "grid",
          placeItems: "center",
          color: last ? BRAND.gold : BRAND.berry,
          background: last ? "rgba(255,255,255,0.1)" : BRAND.blush,
          borderRadius: 38
        }}
      >
        <DayIcon kind={moment.kind} size={92} />
      </div>
      <div>
        <div style={{color: last ? "#f7dcb0" : BRAND.berry, fontFamily: FONT.interface, fontSize: 45, fontWeight: 820, letterSpacing: "0.015em"}}>
          {moment.time}
        </div>
        <div style={{marginTop: 10, fontFamily: FONT.display, fontSize: last ? 94 : 82, fontWeight: 500, lineHeight: 0.98, letterSpacing: "-0.055em"}}>
          {moment.label}
        </div>
        <div style={{marginTop: 15, color: last ? "rgba(255,255,255,0.78)" : BRAND.muted, fontFamily: FONT.interface, fontSize: last ? 39 : 34, fontWeight: 650}}>
          {moment.detail}
        </div>
      </div>
    </div>
  );
};

const DayScene: FC<{moments: DayMoment[]}> = ({moments}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const slotFrames = 14;
  const rail = interpolate(frame, [1, moments.length * slotFrames + 8], [0, 1], clamp);
  const late = interpolate(frame, [slotFrames * 4, slotFrames * 4 + 11], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        color: BRAND.ink,
        background: `linear-gradient(180deg, ${BRAND.warmPaper} 0%, ${BRAND.blush} 70%, ${BRAND.berryDark} 160%)`
      }}
    >
      <SafeFrame style={{paddingBottom: 220}}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <BrandLockup />
          <div style={{color: BRAND.berry, fontFamily: FONT.interface, fontSize: 24, fontWeight: 830, letterSpacing: "0.14em", textTransform: "uppercase"}}>
            A very full day
          </div>
        </div>
        <div style={{position: "absolute", left: 122, top: 300, bottom: 215, width: 5, borderRadius: 999, background: "rgba(173,49,93,0.14)"}}>
          <div style={{width: "100%", height: `${rail * 100}%`, borderRadius: 999, background: late > 0.4 ? BRAND.gold : BRAND.berry}} />
          <div style={{position: "absolute", left: -13, top: `calc(${rail * 100}% - 14px)`, width: 31, height: 31, borderRadius: "50%", background: late > 0.4 ? BRAND.gold : BRAND.berry, boxShadow: "0 0 0 11px rgba(173,49,93,0.11)"}} />
        </div>
      </SafeFrame>
      {moments.map((moment, index) => (
        <DayMomentCard key={`${moment.time}-${moment.label}`} moment={moment} index={index} slotFrames={slotFrames} />
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `rgba(36, 20, 30, ${late * 0.2})`
        }}
      />
    </AbsoluteFill>
  );
};

const BridgeScene: FC<{bridge: string; promise: string}> = ({bridge, promise}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const first = enter(frame, fps, 0.02, 0.32);
  const second = enter(frame, fps, 0.45, 0.42);
  const mark = spring({frame: frame - secondsToFrames(0.74, fps), fps, config: {damping: 18, stiffness: 115}});

  return (
    <AbsoluteFill style={{background: BRAND.blush, color: BRAND.ink}}>
      <AccentOrb style={{right: -240, top: -230, background: "#f6e4cf", opacity: 0.72}} />
      <SafeFrame style={{justifyContent: "center"}}>
        <div style={{maxWidth: 890}}>
          <div
            style={{
              fontFamily: FONT.display,
              fontSize: 119,
              fontWeight: 500,
              lineHeight: 0.98,
              letterSpacing: "-0.06em",
              opacity: first,
              transform: `translateY(${(1 - first) * 30}px)`
            }}
          >
            {bridge}
          </div>
          <div
            style={{
              marginTop: 42,
              color: BRAND.berry,
              fontFamily: FONT.interface,
              fontSize: 70,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.045em",
              opacity: second,
              transform: `translateY(${(1 - second) * 28}px)`
            }}
          >
            {promise}
          </div>
        </div>
        <PeopleOSMark
          size={125}
          style={{
            position: "absolute",
            right: 92,
            bottom: 316,
            opacity: mark,
            transform: `scale(${0.75 + mark * 0.25}) rotate(${(1 - mark) * -8}deg)`,
            boxShadow: "0 24px 50px rgba(127,23,63,0.2)",
            borderRadius: 28
          }}
        />
      </SafeFrame>
    </AbsoluteFill>
  );
};

const StatusBar: FC<{time: string; light?: boolean}> = ({time, light = false}) => (
  <div
    style={{
      position: "absolute",
      top: 28,
      left: 54,
      right: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      color: light ? BRAND.paper : BRAND.ink,
      fontFamily: FONT.interface,
      fontSize: 25,
      fontWeight: 760,
      zIndex: 5
    }}
  >
    <span>{time}</span>
    <div style={{display: "flex", alignItems: "center", gap: 9}}>
      <span style={{width: 26, height: 15, borderRadius: "15px 15px 3px 3px", border: `3px solid ${light ? BRAND.paper : BRAND.ink}`, borderTopWidth: 0}} />
      <span style={{display: "flex", gap: 3}}><i style={{width: 5, height: 8, background: "currentColor", borderRadius: 2}} /><i style={{width: 5, height: 12, background: "currentColor", borderRadius: 2}} /><i style={{width: 5, height: 16, background: "currentColor", borderRadius: 2}} /></span>
      <span style={{width: 31, height: 15, border: "3px solid currentColor", borderRadius: 5, position: "relative"}}><i style={{position: "absolute", inset: 2, right: 5, background: "currentColor", borderRadius: 2}} /></span>
    </div>
  </div>
);

const LockScreen: FC<{time: string; body: string; progress: number}> = ({time, body, progress}) => {
  const notification = Math.min(1, progress * 1.6);
  return (
    <AbsoluteFill style={{background: "linear-gradient(150deg, #f0cada 0%, #f9eaf0 43%, #fff6e9 100%)", color: BRAND.ink}}>
      <StatusBar time={time} />
      <div style={{position: "absolute", top: 110, left: 0, right: 0, textAlign: "center", fontFamily: FONT.interface}}>
        <div style={{fontSize: 30, fontWeight: 700, opacity: 0.72}}>Tuesday 13 August</div>
        <div style={{marginTop: -8, fontSize: 126, fontWeight: 320, letterSpacing: "-0.075em"}}>{time}</div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 400,
          left: 32,
          right: 32,
          minHeight: 190,
          padding: "30px 32px",
          display: "grid",
          gridTemplateColumns: "72px 1fr auto",
          gap: 20,
          alignItems: "start",
          background: "rgba(255,255,255,0.88)",
          border: "1px solid rgba(48,29,36,0.08)",
          borderRadius: 36,
          boxShadow: "0 24px 62px rgba(62,31,42,0.17)",
          backdropFilter: "blur(20px)",
          opacity: notification,
          transform: `translateY(${(1 - notification) * -42}px) scale(${0.96 + notification * 0.04})`
        }}
      >
        <PeopleOSMark size={70} />
        <div style={{fontFamily: FONT.interface}}>
          <div style={{fontSize: 30, fontWeight: 820}}>PeopleOS</div>
          <div style={{marginTop: 9, fontSize: 29, fontWeight: 580, lineHeight: 1.28}}>{body}</div>
        </div>
        <span style={{color: BRAND.muted, fontFamily: FONT.interface, fontSize: 23}}>now</span>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 68, textAlign: "center", color: "rgba(23,19,22,0.62)", fontFamily: FONT.interface, fontSize: 24, fontWeight: 680}}>
        Tap to open Today
      </div>
    </AbsoluteFill>
  );
};

const TodayScreen: FC<{
  personName: string;
  initial: string;
  relationship: string;
  starter: string;
  progress: number;
  actionPulse: number;
}> = ({personName, initial, relationship, starter, progress, actionPulse}) => {
  const contentIn = interpolate(progress, [0, 0.25, 1], [0, 0.9, 1], clamp);
  const actionScale = 1 + Math.sin(actionPulse * Math.PI * 3) * 0.025 * Math.min(1, actionPulse * 2);
  return (
    <AbsoluteFill style={{background: BRAND.paper, color: BRAND.ink, fontFamily: FONT.interface}}>
      <StatusBar time="12:00" />
      <div style={{position: "absolute", top: 78, left: 0, right: 0, height: 86, padding: "0 38px", display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${BRAND.line}`}}>
        <PeopleOSMark size={50} />
        <div>
          <div style={{fontSize: 27, fontWeight: 810, letterSpacing: "-0.025em"}}>PeopleOS</div>
          <div style={{color: BRAND.muted, fontSize: 19, fontWeight: 600}}>Remember people.</div>
        </div>
      </div>
      <div style={{position: "absolute", top: 210, left: 48, right: 48, opacity: contentIn, transform: `translateY(${(1 - contentIn) * 30}px)`}}>
        <div style={{fontFamily: FONT.display, fontSize: 78, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.055em"}}>Today</div>
        <div style={{marginTop: 12, color: BRAND.muted, fontSize: 29, fontWeight: 590}}>People you meant to contact.</div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 390,
          left: 42,
          right: 42,
          minHeight: 585,
          padding: "34px 34px 30px",
          background: BRAND.paper,
          border: "2px solid rgba(115,30,60,0.2)",
          borderRadius: 34,
          boxShadow: "0 20px 55px rgba(78,38,50,0.1)",
          opacity: contentIn,
          transform: `translateY(${(1 - contentIn) * 46}px) scale(${0.98 + contentIn * 0.02})`
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 22}}>
          <div style={{width: 82, height: 82, display: "grid", placeItems: "center", color: BRAND.berryDark, background: BRAND.blushStrong, borderRadius: "50%", fontFamily: FONT.display, fontSize: 44}}>{initial}</div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 39, fontWeight: 790, letterSpacing: "-0.035em"}}>{personName}</div>
            <div style={{marginTop: 4, color: BRAND.muted, fontSize: 24, fontWeight: 620}}>{relationship}</div>
          </div>
          <div style={{width: 54, height: 54, display: "grid", placeItems: "center", color: BRAND.muted, border: `2px solid ${BRAND.line}`, borderRadius: "50%", fontSize: 30}}>✓</div>
        </div>
        <div style={{marginTop: 36, padding: "30px 31px", color: "#51454a", background: BRAND.blush, borderRadius: 26, fontFamily: FONT.display, fontSize: 40, fontWeight: 500, lineHeight: 1.25, letterSpacing: "-0.026em"}}>
          “{starter}”
        </div>
        <div style={{marginTop: 13, color: BRAND.berry, fontSize: 22, fontWeight: 720}}>Another suggestion</div>
        <div style={{marginTop: 34, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16}}>
          <div
            style={{
              minHeight: 98,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              color: BRAND.paper,
              background: BRAND.berry,
              borderRadius: 22,
              boxShadow: `0 0 0 ${Math.max(0, actionPulse - 0.1) * 13}px rgba(173,49,93,0.13)`,
              fontSize: 30,
              fontWeight: 790,
              transform: `scale(${actionScale})`
            }}
          >
            <MessageIcon size={35} color={BRAND.paper} /> Message
          </div>
          <div style={{minHeight: 98, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, color: BRAND.berry, background: BRAND.paper, border: "2px solid rgba(173,49,93,0.28)", borderRadius: 22, fontSize: 30, fontWeight: 790}}>
            <PhoneIcon size={35} /> Call
          </div>
        </div>
        <div style={{marginTop: 24, paddingTop: 20, borderTop: `1px solid ${BRAND.line}`, color: BRAND.muted, fontSize: 22, fontWeight: 660}}>Not today</div>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 0, height: 112, display: "grid", gridTemplateColumns: "repeat(4,1fr)", alignItems: "center", borderTop: `1px solid ${BRAND.line}`, background: "rgba(255,255,255,0.97)", color: BRAND.muted, fontSize: 18, fontWeight: 690, textAlign: "center"}}>
        <span style={{color: BRAND.berry, fontWeight: 820}}>Today</span><span>Reach Out</span><span>People</span><span>Settings</span>
      </div>
    </AbsoluteFill>
  );
};

const ProductScene: FC<{scenario: PeopleOSAdConfig["scenario"]}> = ({scenario}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lockOut = interpolate(frame, [secondsToFrames(0.78, fps), secondsToFrames(1.08, fps)], [1, 0], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const appIn = interpolate(frame, [secondsToFrames(0.83, fps), secondsToFrames(1.18, fps)], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const phoneIn = spring({frame: frame - 2, fps, config: {damping: 18, stiffness: 110}});
  const actionPulse = interpolate(frame, [secondsToFrames(2.28, fps), secondsToFrames(3.65, fps)], [0, 1], clamp);
  const labelIn = enter(frame, fps, 1.25, 0.36);

  return (
    <AbsoluteFill style={{background: BRAND.surfaceSoft, color: BRAND.ink}}>
      <AccentOrb style={{left: -360, top: 530, width: 720, height: 720, opacity: 0.9}} />
      <div
        style={{
          position: "absolute",
          top: 118,
          left: 92,
          right: 92,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: labelIn,
          transform: `translateY(${(1 - labelIn) * 22}px)`
        }}
      >
        <BrandLockup />
        <div style={{color: BRAND.berry, fontFamily: FONT.interface, fontSize: 24, fontWeight: 830, letterSpacing: "0.13em", textTransform: "uppercase"}}>A useful nudge</div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 245,
          left: 130,
          width: 820,
          height: 1430,
          overflow: "hidden",
          background: BRAND.paper,
          border: `15px solid ${BRAND.ink}`,
          borderRadius: 88,
          boxShadow: "0 56px 130px rgba(62,31,42,0.21), 0 12px 32px rgba(62,31,42,0.12)",
          opacity: phoneIn,
          transform: `translateY(${(1 - phoneIn) * 70}px) scale(${0.94 + phoneIn * 0.06})`
        }}
      >
        <div style={{position: "absolute", zIndex: 10, top: 18, left: "50%", width: 210, height: 48, borderRadius: 999, background: BRAND.ink, transform: "translateX(-50%)"}} />
        <div style={{position: "absolute", inset: 0, opacity: lockOut}}>
          <LockScreen time={scenario.notificationTime} body={scenario.notificationBody} progress={Math.min(1, frame / 18)} />
        </div>
        <div style={{position: "absolute", inset: 0, opacity: appIn, transform: `scale(${1.025 - appIn * 0.025})`}}>
          <TodayScreen
            personName={scenario.personName}
            initial={scenario.personInitial}
            relationship={scenario.relationshipLabel}
            starter={scenario.conversationStarter}
            progress={appIn}
            actionPulse={actionPulse}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndScene: FC<{line: string; cta: string}> = ({line, cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const mark = spring({frame: frame - 1, fps, config: {damping: 19, stiffness: 110}});
  const copyIn = enter(frame, fps, 0.17, 0.4);
  const buttonIn = spring({frame: frame - secondsToFrames(0.67, fps), fps, config: {damping: 16, stiffness: 130}});
  const shimmer = interpolate(frame, [0, secondsToFrames(2.7, fps)], [-430, 1200], clamp);

  return (
    <AbsoluteFill style={{overflow: "hidden", background: BRAND.berryDark, color: BRAND.paper}}>
      <div style={{position: "absolute", width: 900, height: 900, right: -480, top: -420, borderRadius: "50%", background: "rgba(199,151,79,0.22)"}} />
      <div style={{position: "absolute", width: 760, height: 760, left: -420, bottom: -310, borderRadius: "50%", background: "rgba(255,248,241,0.08)"}} />
      <div style={{position: "absolute", top: -200, left: shimmer, width: 210, height: 2350, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.065), transparent)", transform: "rotate(18deg)"}} />
      <SafeFrame style={{justifyContent: "center"}}>
        <BrandLockup
          inverse
          size="large"
          style={{
            position: "absolute",
            top: 170,
            left: 92,
            opacity: mark,
            transform: `translateY(${(1 - mark) * -28}px) scale(${0.92 + mark * 0.08})`
          }}
        />
        <div
          style={{
            maxWidth: 885,
            fontFamily: FONT.display,
            fontSize: 111,
            fontWeight: 500,
            lineHeight: 0.97,
            letterSpacing: "-0.06em",
            opacity: copyIn,
            transform: `translateY(${(1 - copyIn) * 36}px)`
          }}
        >
          {splitLines(line).map((part, index) => <div key={`${part}-${index}`}>{part}</div>)}
        </div>
        <div
          style={{
            minHeight: 116,
            marginTop: 72,
            padding: "24px 45px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "stretch",
            color: BRAND.berryDark,
            background: BRAND.paper,
            borderRadius: 999,
            boxShadow: "0 24px 52px rgba(34,8,19,0.24)",
            fontFamily: FONT.interface,
            fontSize: 39,
            fontWeight: 830,
            letterSpacing: "-0.025em",
            textAlign: "center",
            opacity: buttonIn,
            transform: `translateY(${(1 - buttonIn) * 34}px) scale(${0.92 + buttonIn * 0.08})`
          }}
        >
          {cta}
          <span style={{marginLeft: 18, fontSize: 48, lineHeight: 1}}>→</span>
        </div>
      </SafeFrame>
    </AbsoluteFill>
  );
};

export const PeopleOSAd: FC<PeopleOSAdConfig> = (config) => (
  <AbsoluteFill style={{background: BRAND.paper}}>
    <Scene window={config.timings.opening}>
      <OpeningScene text={config.copy.opening} />
    </Scene>
    <Scene window={config.timings.guilt}>
      <GuiltScene lead={config.copy.guiltLead} action={config.copy.guiltAction} emphasis={config.copy.guiltEmphasis} />
    </Scene>
    <Scene window={config.timings.day}>
      <DayScene moments={config.scenario.dayMoments} />
    </Scene>
    <Scene window={config.timings.bridge}>
      <BridgeScene bridge={config.copy.bridge} promise={config.copy.promise} />
    </Scene>
    <Scene window={config.timings.product} fadeFrames={6}>
      <ProductScene scenario={config.scenario} />
    </Scene>
    <Scene window={config.timings.end} fadeFrames={6} fadeOut={false}>
      <EndScene line={config.copy.endLine} cta={config.copy.cta} />
    </Scene>
  </AbsoluteFill>
);
