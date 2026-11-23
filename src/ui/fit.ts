import { STAGE_H, STAGE_W } from './shell'

/**
 * Match-height fit. The on-screen box fills the window.
 * Design height stays 2436 and width grows with the screen.
 * A screen narrower than 1125 matches width instead, so the
 * bottom sheets are not cropped, and the panel grows taller.
 */
export interface StageFit {
  scale: number
  x: number
  y: number
  width: number
  height: number
  panelW: number
  panelH: number
}

export function stageFit(screenW: number, screenH: number): StageFit {
  const sw = Math.max(1, screenW)
  const sh = Math.max(1, screenH)
  const scale = sw / sh >= STAGE_W / STAGE_H ? sh / STAGE_H : sw / STAGE_W
  return {
    scale,
    x: 0,
    y: 0,
    width: sw,
    height: sh,
    panelW: sw / scale,
    panelH: sh / scale,
  }
}

/** Screen pixels in the same space as the stage rectangle to panel pixels. */
export function screenToStage(
  px: number,
  py: number,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const fit = stageFit(box.width, box.height)
  const pw = Math.max(2, Math.round(fit.panelW))
  const ph = Math.max(2, Math.round(fit.panelH))
  const sx = box.width > 0 ? pw / box.width : 1
  const sy = box.height > 0 ? ph / box.height : 1
  return { x: (px - box.x) * sx, y: (py - box.y) * sy }
}
