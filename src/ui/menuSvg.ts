// Pieces exported from Figma P2q0ZoaiyNb0svqyi6S39o (canvas 20284:32844).
// Weather HUD glyphs stay in hudSvg: the frame export includes the screen plate.

/** Song-row equalizer, node 22773:112970 */
export const rowEqSvg = `<svg width="12.3" height="13.65" viewBox="0 0 12.3002 13.6463" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M1.25 9.25L1.25 11.9817" stroke-width="2.5" stroke-linecap="round" stroke="#00A375"/>
<path d="M11.0502 6.25L11.0502 12.3963" stroke-width="2.5" stroke-linecap="round" stroke="#00A375"/>
<path d="M6.15027 1.25L6.15027 12.1768" stroke-width="2.5" stroke-linecap="round" stroke="#00A375"/>
</svg>`

/** Weather / volume tick, node 22782:115228 */
export const sliderDotSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="6" cy="6" r="6" fill="#D8D8DA"/>
</svg>`

/** Play-mode arrow half, node 22782:114023 */
export const modeArrowSvg = `<svg width="11" height="11" viewBox="0 0 10.7324 10.5937" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5.88177 6.54061V9.52455C5.88177 9.94879 6.37685 10.1803 6.70239 9.90823L9.25189 7.77775C9.75391 7.35824 9.45726 6.54061 8.80303 6.54061H5.88177Z" fill="#19191A"/>
<path d="M1.67593 0.500007C0.676675 1.36945 0.444218 2.6636 0.510344 3.87149C0.618848 5.85348 2.54159 7.03647 4.52654 7.03647H8.15504" stroke-width="1.2" stroke-linecap="round" stroke="#19191A"/>
</svg>`

const arrow = `<path d="M5.88177 6.54061V9.52455C5.88177 9.94879 6.37685 10.1803 6.70239 9.90823L9.25189 7.77775C9.75391 7.35824 9.45726 6.54061 8.80303 6.54061H5.88177Z" fill="#19191A"/>
<path d="M1.67593 0.500007C0.676675 1.36945 0.444218 2.6636 0.510344 3.87149C0.618848 5.85348 2.54159 7.03647 4.52654 7.03647H8.15504" stroke-linecap="round" stroke="#19191A"/>`

/** 单曲 pill, Figma 播放规则 60×28. Label is drawn by the canvas. */
export const modeSingleSvg = `<svg width="60" height="28" viewBox="0 0 60 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0.25" y="0.25" width="59.5" height="27.5" rx="14" stroke="#D8D8DA" stroke-width="0.5"/>
<g transform="translate(8.04 10.63)">${arrow}</g>
<g transform="translate(16.09 11.57) rotate(180) translate(-5.37 -5.3)">${arrow}</g>
<text x="15" y="14.2" text-anchor="middle" dominant-baseline="central" fill="#19191A" font-size="7" font-family="PingFang SC, sans-serif" font-weight="600">1</text>
</svg>`

/** 循环 pill. Node 22782:114192. */
export const modeLoopSvg = `<svg width="60" height="28" viewBox="0 0 60 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0.25" y="0.25" width="59.5" height="27.5" rx="14" stroke="#D8D8DA" stroke-width="0.5"/>
<g transform="translate(8.24 8.9)">
<path d="M9.61666 2.33767H4.42653C2.25797 2.33767 0.5 4.09564 0.5 6.2642C0.5 8.43276 2.25797 10.1907 4.42653 10.1907H8.10029C10.1577 10.1907 11.8256 8.52287 11.8256 6.46546" stroke-linecap="round" stroke="#19191A"/>
<path d="M11.2725 1.90488C11.6059 2.09733 11.6059 2.57845 11.2725 2.7709L9.2657 3.92955C8.93236 4.122 8.5157 3.88144 8.5157 3.49654L8.5157 1.17924C8.5157 0.794343 8.93237 0.553781 9.2657 0.746231L11.2725 1.90488Z" fill="#19191A"/>
</g>
</svg>`

/** 随机 pill. Node 22782:115313. Lower arrow is flipped like the component. */
export const modeShuffleSvg = `<svg width="60" height="28" viewBox="0 0 60 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0.25" y="0.25" width="59.5" height="27.5" rx="14" stroke="#D8D8DA" stroke-width="0.5"/>
<g transform="translate(8.91 7.95)">
<path d="M0.5 9.75434C2.4141 9.75434 4.11419 8.5315 4.72302 6.71681L5.35086 4.84545C5.83153 3.41276 7.1382 2.41877 8.6472 2.3379" stroke-linecap="round" stroke-linejoin="round" stroke="#19191A"/>
<path d="M10.9304 1.90489C11.2637 2.09734 11.2637 2.57846 10.9304 2.77091L8.92357 3.92956C8.59024 4.12201 8.17357 3.88145 8.17357 3.49655L8.17357 1.17925C8.17357 0.794351 8.59024 0.553789 8.92357 0.746239L10.9304 1.90489Z" fill="#19191A"/>
</g>
<g transform="translate(15 15.17) scale(1 -1) translate(-15 -15.17) translate(8.91 10.29)">
<path d="M8.81945 2.37214C8.81945 2.37214 7.82175 2.2705 7.03716 2.66808C6.25256 3.06567 5.70204 4.00341 5.70204 4.00341" stroke-linecap="round" stroke-linejoin="round" stroke="#19191A"/>
<path d="M0.5 9.75411H1.615C2.65091 9.75411 3.56408 9.07438 3.86133 8.08203" stroke-linecap="round" stroke-linejoin="round" stroke="#19191A"/>
<path d="M10.9307 1.90489C11.264 2.09734 11.264 2.57846 10.9307 2.77091L8.92383 3.92956C8.59049 4.12201 8.17383 3.88145 8.17383 3.49655L8.17383 1.17925C8.17383 0.794351 8.5905 0.553789 8.92383 0.746239L10.9307 1.90489Z" fill="#19191A"/>
</g>
</svg>`
