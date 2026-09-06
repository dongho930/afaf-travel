/**
 * 웹용 Pretendard CSS(public/fonts/pretendard.css)를 만들어내는 스크립트입니다.
 *
 * 왜 필요한가:
 * 앱(네이티브)은 폰트 파일을 앱 안에 들고 있지만, 웹은 브라우저가 내려받아야
 * 합니다. 예전에는 expo-font가 실행 중에 OTF 5개(각 1.5MB, 합계 약 7.5MB)를
 * 통째로 받을 때까지 화면에 아무것도 그리지 않았습니다.
 *
 * Pretendard는 글자 범위(unicode-range)별로 잘게 나눈 웹폰트(동적 서브셋)를
 * 제공합니다. 이걸 쓰면 브라우저가 "실제로 화면에 나온 글자"가 든 조각만
 * 내려받습니다(조각 하나가 약 18KB). 다만 공식 CSS는 'Pretendard' 한 이름에
 * 굵기(font-weight)로 구분하는데, 이 앱은 굵기별로 다른 이름(Pretendard-Bold 등)을
 * 쓰기 때문에 그대로는 안 맞습니다. 그래서 공식 CSS를 읽어 이 앱의 이름 규칙에
 * 맞게 다시 써주는 것이 이 스크립트입니다.
 *
 * 실행: node scripts/generate-web-fonts-css.js
 * (pretendard 패키지 버전을 올린 뒤 다시 실행하면 됩니다)
 */
const fs = require("fs");
const path = require("path");

const VERSION = require("pretendard/package.json").version;
const SOURCE_CSS = require.resolve(
  "pretendard/dist/web/static/pretendard-dynamic-subset.css"
);
const OUTPUT = path.join(__dirname, "..", "public", "fonts", "pretendard.css");
const CDN_BASE = `https://cdn.jsdelivr.net/npm/pretendard@${VERSION}/dist/web/static/woff2-dynamic-subset`;

// 이 앱이 쓰는 굵기만 골라냅니다 (constants/fonts.ts의 fontFamily와 1:1로 맞춤).
const WEIGHT_TO_FAMILY = {
  400: "Pretendard-Regular",
  500: "Pretendard-Medium",
  600: "Pretendard-SemiBold",
  700: "Pretendard-Bold",
  800: "Pretendard-ExtraBold",
};

const css = fs.readFileSync(SOURCE_CSS, "utf8");
const blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];

const out = [];
let kept = 0;
for (const block of blocks) {
  const weight = (block.match(/font-weight:\s*(\d+)/) || [])[1];
  const family = WEIGHT_TO_FAMILY[weight];
  if (!family) continue;

  const file = (block.match(/([\w-]+\.subset\.\d+\.woff2)/) || [])[1];
  const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
  if (!file || !range) continue;

  out.push(
    [
      "@font-face {",
      `  font-family: '${family}';`,
      "  font-style: normal;",
      // 이 앱은 굵기를 이름으로 구분하므로, 어떤 font-weight 값이 와도 이 파일이
      // 그대로 쓰이도록 전체 범위를 받아줍니다(브라우저가 가짜 굵게를 만들지 않게).
      "  font-weight: 100 900;",
      // 폰트가 도착하기 전에는 기본 글꼴로 즉시 보여주고, 도착하면 바꿔 끼웁니다.
      "  font-display: swap;",
      `  src: url(${CDN_BASE}/${file}) format('woff2');`,
      `  unicode-range: ${range.trim()};`,
      "}",
    ].join("\n")
  );
  kept += 1;
}

const header = `/*
 * 이 파일은 scripts/generate-web-fonts-css.js가 만들어낸 것입니다. 직접 고치지 마세요.
 * (고쳐야 하면 스크립트를 고치고 다시 실행하세요)
 *
 * Pretendard ${VERSION}의 동적 서브셋을 이 앱의 굵기별 이름에 맞춰 다시 쓴 것입니다.
 * 브라우저는 화면에 실제로 나온 글자가 들어있는 조각만 내려받습니다.
 *
 * Pretendard는 SIL Open Font License 1.1로 배포됩니다.
 * https://github.com/orioncactus/pretendard
 */
`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, header + out.join("\n") + "\n", "utf8");

const sizeKb = (fs.statSync(OUTPUT).size / 1024).toFixed(0);
console.log(`생성 완료: ${path.relative(process.cwd(), OUTPUT)}`);
console.log(`  @font-face ${kept}개 (굵기 ${Object.keys(WEIGHT_TO_FAMILY).length}종), ${sizeKb}KB`);
