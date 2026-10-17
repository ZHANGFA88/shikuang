// 电视直播墙：与首页 05 共用一份代码（compact 变体）。
// 行为定版（2026-10-18 移动端打磨后）：
// - 轻门面先行：未激活的席位只渲染纸面门面（频道名 + 播放钮），不加载 YouTube 播放器，
//   页面首载零视频重量；激活才注入 iframe（静音预播）。
// - 激活时机：细指针设备（桌面）由 IntersectionObserver 在席位接近视口时激活；
//   粗指针设备（手机/平板触屏）默认不自动激活，点门面才播——省流量也免滚动卡顿；
//   唯一例外：触屏打开 /live（目的地页）自动激活第一席一路流，开门见活（架构裁定）。
//   poster 降级形态（?mode=poster）一律点播。
// - 全屏三级链：元素 requestFullscreen（桌面/Android/iPad）→ iframe requestFullscreen →
//   剧场模式（position:fixed 满屏 + 退出钮），iPhone Safari 无元素全屏 API 时走剧场兜底，
//   不再出现「点了没反应」。进入任一全屏形态后经播放器 onReady 解静音（音量 80），
//   退出统一回静音、播放不中断。激活后的 iframe 直接吃点击（原生控件与其全屏钮可用），
//   不再设全幅拦截层。
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CHANNELS, type LiveChannel } from "./channels";

/** ?mode=poster 解析（首页与直播页共用，原先两处各写一份）。 */
export function usePosterMode(): boolean {
  const [params] = useSearchParams();
  return params.get("mode") === "poster";
}

/** 粗指针（触屏）判定：副题文案随态切换用（预播口径 vs 点播口径）。 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return coarse;
}

interface YTPlayer {
  unMute(): void;
  mute(): void;
  setVolume(v: number): void;
  playVideo(): void;
}

interface PlayerHandle {
  player: YTPlayer;
  ready: Promise<void>;
}

let ytPromise: Promise<void> | null = null;
function loadYT(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}

function stateLabel(data: number): string {
  return data === 1 ? "直播中" : data === 3 ? "缓冲中" : data === 2 ? "已暂停" : "连接中";
}

export function LiveWall({
  compact = false,
  watching,
  onWatch,
  poster = false,
}: {
  compact?: boolean;
  watching?: LiveChannel | null;
  onWatch?: (ch: LiveChannel) => void;
  poster?: boolean;
}) {
  const navigate = useNavigate();
  const [innerWatch, setInnerWatch] = useState<LiveChannel | null>(null);
  const selected = watching !== undefined ? watching : innerWatch;
  const [status, setStatus] = useState<Record<string, string>>({});
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const [theater, setTheater] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const players = useRef(new Map<string, PlayerHandle>());
  const theaterRef = useRef<string | null>(null);
  theaterRef.current = theater;

  const select = (ch: LiveChannel) => {
    setInnerWatch(ch);
    onWatch?.(ch);
  };

  const activate = (no: string) => {
    setActive((prev) => (prev.has(no) ? prev : new Set(prev).add(no)));
  };

  const muteAll = () => {
    players.current.forEach(({ player }) => {
      try {
        player.mute();
      } catch {
        /* 播放器已卸载 */
      }
    });
  };

  // 退出全屏（原生或剧场）统一回静音，播放不中断。
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) muteAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && theaterRef.current) {
        setTheater(null);
        muteAll();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // 细指针设备：席位接近视口才激活静音预播；粗指针（触屏）默认不自动激活，
  // 例外只有 /live 第一席（架构裁定：目的地页一路流开门见活），首页紧凑墙不自动。
  useEffect(() => {
    if (poster) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(hover: none)").matches) {
      if (!compact) {
        const first = CHANNELS.find((c) => c.live);
        if (first) activate(first.no);
      }
      return;
    }
    const board = boardRef.current;
    if (!board || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const no = (en.target as HTMLElement).dataset.lvNo;
            if (no) activate(no);
          }
        }
      },
      { rootMargin: "300px" },
    );
    board.querySelectorAll<HTMLElement>("[data-lv-no]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [poster, compact]);

  /** 注入/取得播放器句柄；ready 在 YT onReady 时兑现（取代原先的定时猜测）。 */
  const ensurePlayer = (ch: LiveChannel): Promise<PlayerHandle | null> => {
    const existing = players.current.get(ch.no);
    if (existing) return Promise.resolve(existing);
    return loadYT().then(async () => {
      const w = window as unknown as {
        YT?: {
          Player: new (
            id: string,
            opts: {
              events: {
                onReady: () => void;
                onStateChange: (e: { data: number }) => void;
              };
            },
          ) => YTPlayer;
        };
      };
      if (!w.YT?.Player) return null;
      // 等 iframe 真正挂进 DOM（激活是异步渲染）。
      for (let i = 0; i < 20 && !document.getElementById(`lv-yt-${ch.no}`); i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (!document.getElementById(`lv-yt-${ch.no}`)) return null;
      const again = players.current.get(ch.no);
      if (again) return again;
      let resolveReady!: () => void;
      const ready = new Promise<void>((r) => {
        resolveReady = r;
      });
      try {
        const player = new w.YT.Player(`lv-yt-${ch.no}`, {
          events: {
            onReady: () => resolveReady(),
            onStateChange: (e) => {
              setStatus((s) => ({ ...s, [ch.no]: stateLabel(e.data) }));
            },
          },
        });
        const handle = { player, ready };
        players.current.set(ch.no, handle);
        return handle;
      } catch {
        return null;
      }
    });
  };

  const goFull = (ch: LiveChannel) => {
    select(ch);
    activate(ch.no);
    // 全屏请求必须留在用户手势内同步发出：元素 → iframe → 剧场兜底。
    const cell = cellRefs.current.get(ch.no);
    let entered = false;
    try {
      if (cell && typeof cell.requestFullscreen === "function") {
        entered = true;
        cell.requestFullscreen().catch(() => {
          // 承诺被拒（如权限策略）：退到剧场模式，仍给满屏。
          if (!document.fullscreenElement) setTheater(ch.no);
        });
      }
    } catch {
      entered = false;
    }
    if (!entered) {
      const frame = cell?.querySelector("iframe");
      if (frame && typeof frame.requestFullscreen === "function") {
        entered = true;
        frame.requestFullscreen().catch(() => setTheater(ch.no));
      }
    }
    if (!entered) setTheater(ch.no);
    // 播放器就绪后解静音（不等手势过期：音量操作无手势要求）。
    void ensurePlayer(ch).then((handle) => {
      if (!handle) return;
      void Promise.race([handle.ready, new Promise((r) => setTimeout(r, 2500))]).then(() => {
        try {
          handle.player.unMute();
          handle.player.setVolume(80);
          handle.player.playVideo();
        } catch {
          /* 播放器未就绪时忽略 */
        }
      });
    });
  };

  const onFacadeTap = (ch: LiveChannel) => {
    // 首页紧凑墙在触屏上点门面 = 进直播页（版面里再点播），桌面则原地激活预播。
    if (compact && typeof window !== "undefined" && window.matchMedia("(hover: none)").matches) {
      navigate("/live");
      return;
    }
    select(ch);
    activate(ch.no);
    void ensurePlayer(ch);
  };

  const exitTheater = () => {
    setTheater(null);
    muteAll();
  };

  const seats = compact ? CHANNELS.filter((c) => c.live) : CHANNELS;
  return (
    <div ref={boardRef} className={`lv-board${compact ? " lv-compact" : ""}`}>
      {seats.map((ch) =>
        ch.live ? (
          <section
            key={ch.no}
            data-lv-no={ch.no}
            ref={(el) => {
              if (el) cellRefs.current.set(ch.no, el);
              else cellRefs.current.delete(ch.no);
            }}
            className={`lv-cell${selected?.no === ch.no ? " selected" : ""}${theater === ch.no ? " theater" : ""}`}
          >
            <div className="lv-frame">
              {active.has(ch.no) ? (
                <iframe
                  id={`lv-yt-${ch.no}`}
                  title={ch.name}
                  src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${ch.cid}&enablejsapi=1&autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <button type="button" className="lv-facade" onClick={() => onFacadeTap(ch)} aria-label={`播放 ${ch.name}`}>
                  <span className="lv-facade-live">
                    <span className="lv-dot" /> LIVE
                  </span>
                  <span className="lv-facade-play" aria-hidden="true">
                    ▶
                  </span>
                  <span className="lv-facade-name">{ch.name}</span>
                  <span className="lv-facade-hint">{compact ? "点播" : "点击播放 · 静音预播"}</span>
                </button>
              )}
              {theater === ch.no && (
                <>
                  <div className="lv-hint show">横屏观看更佳</div>
                  <button type="button" className="lv-exit" onClick={exitTheater}>
                    退出全屏 ✕
                  </button>
                </>
              )}
            </div>
            <div className="lv-cap">
              <span className="lv-no">{ch.no}</span>
              <span className="lv-name">{ch.name}</span>
              <span className="lv-status">
                <span className="lv-dot" />
                {status[ch.no] ?? (active.has(ch.no) ? "连接中" : "待播")}
              </span>
              <span className="lv-btns">
                {compact ? (
                  <Link className="lv-btn lv-watch" to="/live">
                    陪看
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={`lv-btn lv-watch${selected?.no === ch.no ? " on" : ""}`}
                    onClick={(ev) => {
                      select(ch);
                      ev.currentTarget.blur();
                    }}
                  >
                    {selected?.no === ch.no ? "观看中" : "陪看"}
                  </button>
                )}
                <button type="button" className="lv-btn" onClick={() => goFull(ch)}>
                  全屏观看 ⛶
                </button>
              </span>
            </div>
            {!compact && <p className="lv-fig">{ch.fig}</p>}
          </section>
        ) : (
          <section key={ch.no} className="lv-cell">
            <div className="lv-frame">
              <div className="lv-pending">
                <div className="lv-stamp">待验</div>
                <div className="lv-pnote">复测窗口：亚洲日间 10:00–16:00</div>
              </div>
            </div>
            <div className="lv-cap">
              <span className="lv-no">{ch.no}</span>
              <span className="lv-name">{ch.name}</span>
              <span className="lv-status grey">
                <span className="lv-dot" />
                待验 · 暂不播出
              </span>
            </div>
            {!compact && <p className="lv-fig">{ch.fig}</p>}
          </section>
        ),
      )}
    </div>
  );
}
