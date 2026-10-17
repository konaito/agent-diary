// Sparkle Design（グッドパッチ）の部品と同じクラス構成。React 版 sparkle-design の cva の値を写している。
// Tailwind はこのファイルの文字列からクラスを拾うので、クラス名は組み立てずにそのまま書く
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-border-ring focus-visible:ring-offset-2";

const BUTTON_BASE = `relative inline-flex items-center justify-center gap-0.5 whitespace-nowrap rounded-action transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0 ${FOCUS}`;
const BUTTON_SIZE = {
  sm: "h-8 min-w-16 px-3 py-1 character-2-bold-pro",
  md: "h-10 min-w-20 px-4 py-1.5 character-3-bold-pro",
  lg: "h-12 min-w-24 px-5 py-2 character-4-bold-pro",
};
const BUTTON_LOOK = {
  "solid primary":
    "border shadow-raise bg-primary-500 text-white border-primary-600 hover:bg-primary-600 hover:border-primary-700 active:bg-primary-700 active:border-primary-800 disabled:bg-primary-200 disabled:border-none",
  "outline neutral":
    "border shadow-raise bg-white text-neutral-700 border-neutral-300 hover:bg-[var(--color-black-alpha-50)] active:bg-[var(--color-black-alpha-100)] disabled:bg-[var(--color-white-alpha-700)] disabled:border-neutral-100 disabled:text-neutral-200",
  "ghost primary":
    "text-primary-500 hover:bg-primary-50 active:bg-primary-100 active:text-primary-600 disabled:text-primary-200",
  "ghost neutral":
    "text-neutral-700 hover:bg-[var(--color-black-alpha-50)] active:bg-[var(--color-black-alpha-100)] disabled:text-neutral-200",
};
// ボタンのアイコンの大きさ。sm は 16px、md と lg は 20px
const BUTTON_ICON = { sm: 3, md: 5, lg: 5 };

export const button = ({ variant = "solid", theme = "primary", size = "md" } = {}) =>
  `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_LOOK[`${variant} ${theme}`]}`;

// アイコンだけのボタン。ghost neutral の sm
export const iconButton = `inline-flex items-center justify-center whitespace-nowrap rounded-action transition-colors cursor-pointer w-8 h-8 p-1.5 ${BUTTON_LOOK["ghost neutral"]} ${FOCUS}`;

// Material Symbols Rounded のアイコン。size は Sparkle の icon-1〜12。太さは icon-* が決める
export const icon = (name, size = 3, { fill = false, cls = "" } = {}) =>
  `<span class="icon-${size}-fill-${fill ? 1 : 0} select-none ${cls}" aria-hidden="true">${name}</span>`;

export const buttonIcon = (name, size = "md") => icon(name, BUTTON_ICON[size], { cls: "-ml-0.5 mr-1" });

export const input = {
  wrap: "flex gap-0 items-center w-full rounded-action border bg-white transition-colors p-1 border-neutral-500 hover:border-neutral-600 focus-within:ring-2 focus-within:ring-border-ring focus-within:ring-offset-2",
  md: "h-10 character-3-regular-pro",
  lg: "h-12 character-4-regular-pro",
  field: "w-full h-full bg-transparent border-none outline-hidden text-text-high placeholder:text-text-placeholder px-2",
};

// select は Sparkle の Select のトリガーと同じ見た目にした素の select
export const select = {
  wrap: "relative",
  field: `appearance-none flex items-center w-full rounded-action border bg-white text-text-high transition-colors cursor-pointer h-10 py-1 pl-3 pr-9 character-3-regular-pro border-neutral-500 hover:border-neutral-600 ${FOCUS}`,
  icon: "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-700",
};

export const label = "flex items-center gap-2 character-2-regular-pro leading-none select-none text-text-high";
export const fieldMessage = "flex gap-1 items-center character-1-regular-pro text-text-low min-h-5";
export const fieldError = "flex gap-1 items-center character-1-regular-pro text-negative-500 min-h-5";

export const tag = {
  base: "inline-flex items-center justify-center rounded-notice h-fit min-w-0 py-0 px-2 character-1-bold-pro",
  neutral: "bg-neutral-100 text-neutral-600",
  primary: "bg-primary-100 text-primary-600",
  warning: "bg-warning-100 text-warning-600",
  negative: "bg-negative-100 text-negative-600",
};
// 押すと絞り込めるタグ。Tag の見た目に押せる表示を足している
export const tagButton = `${tag.base} ${tag.neutral} min-h-6 cursor-pointer transition-colors hover:bg-neutral-200 active:bg-neutral-300 ${FOCUS}`;

export const card = {
  base: "rounded-minimum border border-divider-middle bg-white text-text-middle shadow-raise",
  header: "flex flex-col gap-1 px-6 pt-4 pb-2",
  title: "character-5-bold-pro text-text-high",
  content: "px-6 py-2",
  footer: "flex items-center px-6 py-2",
};

export const inlineMessage = {
  info: "relative w-full rounded-md border p-3 flex gap-2 items-start bg-info-50 border-info-300",
  icon: "inline-flex p-1 items-center justify-center text-info-400",
  body: "flex-1 min-h-8 pt-1 character-3-regular-pro text-text-middle",
};

export const link = "transition-colors text-info-500 hover:text-info-600 underline decoration-current underline-offset-2 rounded-minimum " + FOCUS;
// 別タブで開くリンク。Sparkle の Link と同じく open_in_new を付ける
export const externalLink = (href, text, size = 3) =>
  `<a class="${link}" href="${href}" target="_blank" rel="noreferrer">${text}${icon("open_in_new", size, { cls: "ml-1 align-middle inline-block" })}</a>`;

// 小さな丸。未登録などの知らせに使う Badge
export const dot = "inline-block w-2 h-2 min-w-2 rounded-full bg-negative-500";

// 入力フォームを出すので Sparkle の Modal に合わせる。スマホでは下から出るシート（halfModal の角丸）にする
export const dialog = {
  overlay: "fixed inset-0 z-50 bg-black/50",
  panel:
    "sheet fixed z-50 inset-x-0 bottom-0 max-h-[85vh] overflow-auto bg-white border border-divider-low rounded-t-halfModal shadow-popout px-6 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:max-h-[calc(100vh-80px)] sm:rounded-modal sm:pb-6",
  title: "text-text-high character-4-bold-pro pr-8",
  text: "text-text-middle character-2-regular-pro mt-2",
};
