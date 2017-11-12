const canvasWidth = 640 * devicePixelRatio, canvasHeight = 480 * devicePixelRatio;
const canvasCursorRenderer = <HTMLCanvasElement>document.getElementById("cursor-renderer");
const canvasUserDrawing = <HTMLCanvasElement>document.getElementById("user-drawing");
const canvasGravityHud = <HTMLCanvasElement>document.getElementById("gravity-hud");

for (let canvas of [canvasCursorRenderer, canvasUserDrawing, canvasGravityHud]) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.getContext("2d").clearRect(0, 0, canvasWidth, canvasHeight);
    canvas.getContext("2d").translate(-.5, -.5);
    canvas.style.width = canvasWidth / devicePixelRatio + "px";
    canvas.style.height = canvasHeight / devicePixelRatio + "px";
}

let canvasContainer = document.getElementById("canvas-container");
canvasContainer.style.width = canvasWidth / devicePixelRatio + "px";
canvasContainer.style.height = canvasHeight / devicePixelRatio + "px";
const canvasRect = canvasContainer.getBoundingClientRect();

interface Point {x: number, y:number}
function newPoint(): Point {
    return {x: 0, y: 0};
}

const gravityCenter: Point = {x: canvasWidth / 2, y: canvasHeight / 2};
let gravityHoleRadius = -1; // to force initial update
let gravityForceRadius = -1; // to force initial update

// Convert event.pageX into coordinates of the canvas
function rawClientPosToCanvasPos(destPoint: Point, rawPageX: number, rawPageY: number) {
    const beforeTransformX = Math.round((rawPageX - canvasRect.left) * devicePixelRatio);
    const beforeTransformY = Math.round((rawPageY - canvasRect.top) * devicePixelRatio);
    transformCursorPosition(destPoint, beforeTransformX, beforeTransformY);
    return destPoint;
}

function addCursorMovementListener(listener: (x: number, y: number) => void) {
    const cachePoint: Point = newPoint();
    if ("PointerEvent" in window && "getCoalescedEvents" in PointerEvent.prototype) {
        canvasCursorRenderer.addEventListener("pointermove", (ev) => {
            const coalescedEvents: PointerEvent[] = (<any>ev).getCoalescedEvents();
            // Trigger only last event
            const lastEvent = coalescedEvents[coalescedEvents.length - 1];
            rawClientPosToCanvasPos(cachePoint, lastEvent.pageX, lastEvent.pageY);
            listener(cachePoint.x, cachePoint.y);
        })
    } else {
        canvasCursorRenderer.addEventListener("mousemove", (event) => {
            rawClientPosToCanvasPos(cachePoint, event.pageX, event.pageY);
            listener(cachePoint.x, cachePoint.y);
        });
    }
}

function addDrawingListener(listener: (ax: number, ay: number, bx: number, by: number) => void) {
    // Mouse handler
    let previousMousePos: Point | null = null;
    let mouseButtonIsDown = false;

    canvasCursorRenderer.addEventListener("mousedown", ev => {
        if (ev.button == 0) {
            previousMousePos = rawClientPosToCanvasPos(newPoint(), ev.pageX, ev.pageY);
            mouseButtonIsDown = true;
        }
    });
    canvasCursorRenderer.addEventListener("mouseup", ev => {
        if (ev.button == 0) {
            mouseButtonIsDown = false;
        }
    });

    const cachePoint = newPoint(); // only used by propagateMovement()
    function propagateMovement(previousMousePos: Point, rawPageX: number, rawPageY: number) {
        rawClientPosToCanvasPos(cachePoint, rawPageX, rawPageY);
        listener(previousMousePos.x, previousMousePos.y, cachePoint.x, cachePoint.y);
        previousMousePos.x = cachePoint.x;
        previousMousePos.y = cachePoint.y;
    }

    if ("PointerEvent" in window && "getCoalescedEvents" in PointerEvent.prototype) {
        canvasCursorRenderer.addEventListener("pointermove", (ev) => {
            const coalescedEvents: PointerEvent[] = (<any>ev).getCoalescedEvents();
            for (let event of coalescedEvents) {
                if (mouseButtonIsDown) {
                    propagateMovement(previousMousePos!, event.pageX, event.pageY);
                }
            }
        })
    } else {
        canvasCursorRenderer.addEventListener("mousemove", event => {
            if (mouseButtonIsDown) {
                propagateMovement(previousMousePos!, event.pageX, event.pageY)
            }
        });
    }

    // Touch handler
    const touchPreviousPosMap = new Map<number, Point>();
    canvasCursorRenderer.addEventListener("touchstart", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            touchPreviousPosMap.set(touch.identifier, rawClientPosToCanvasPos(newPoint(), touch.pageX, touch.pageY));
        }
    });
    canvasCursorRenderer.addEventListener("touchend", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            touchPreviousPosMap.delete(touch.identifier);
        }
    });
    canvasCursorRenderer.addEventListener("touchmove", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            propagateMovement(touchPreviousPosMap.get(touch.identifier), touch.pageX, touch.pageY);
        }
    });
}

function clearCanvas(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(-2, -2, canvasWidth + 4, canvasHeight + 4);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, crossRadius: number) {
    const topY = y - crossRadius;
    const bottomY = y + crossRadius;
    const topBottomX = x;

    const leftX = x - crossRadius;
    const rightX = x + crossRadius;
    const leftRightY = y;

    ctx.beginPath();
    ctx.moveTo(topBottomX, topY);
    ctx.lineTo(topBottomX, bottomY);
    ctx.moveTo(leftX, leftRightY);
    ctx.lineTo(rightX, leftRightY);
    ctx.stroke();
}

function drawCanvasGravityHud() {
    const ctx = canvasGravityHud.getContext("2d");
    clearCanvas(ctx);
    ctx.strokeStyle = "#AAAAAA";

    drawCrosshair(ctx, gravityCenter.x, gravityCenter.y, 2);

    ctx.beginPath();
    ctx.arc(gravityCenter.x, gravityCenter.y, gravityHoleRadius, 0, 360);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(gravityCenter.x, gravityCenter.y, gravityForceRadius, 0, 360);
    ctx.stroke();
}

function transformCursorPosition(ret: Point, x: number, y: number): Point {

    const vx = x - gravityCenter.x;
    const vy = y - gravityCenter.y;
    const d = Math.sqrt(vx * vx + vy * vy);

    if (d <= gravityHoleRadius) {
        // Inside the black hole
        ret.x = gravityCenter.x;
        ret.y = gravityCenter.y;
    } else if (d < gravityForceRadius) {
        // Near the black hole
        const angle = Math.atan2(vy, vx);

        const t = (d - gravityHoleRadius) / (gravityForceRadius - gravityHoleRadius);
        const newD = t * gravityForceRadius;

        ret.x = gravityCenter.x + Math.cos(angle) * newD;
        ret.y = gravityCenter.y + Math.sin(angle) * newD;
    } else {
        // Unaffected by gravity.
        ret.x = x;
        ret.y = y;
    }

    return ret;
}

let lastCursorPosition: Point|null;
addCursorMovementListener((x, y) => {
    // Draw crosshair
    const ctx = canvasCursorRenderer.getContext("2d");
    const crossRadius = 3;

    if (lastCursorPosition != null) {
        ctx.clearRect(lastCursorPosition.x - crossRadius - 1,
            lastCursorPosition.y - crossRadius - 1,
            crossRadius * 2 + 2, crossRadius * 2 + 2);
    }

    // Draw new crosshair
    drawCrosshair(ctx, x, y, 3);

    if (lastCursorPosition == null) {
        lastCursorPosition = {x: 0, y: 0};
    }
    lastCursorPosition.x = x;
    lastCursorPosition.y = y;
});

addDrawingListener((ax, ay, bx, by) => {
    const ctx = canvasUserDrawing.getContext("2d");

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
});

function clearUserDrawingCanvas() {
    const ctx = canvasUserDrawing.getContext("2d");
    clearCanvas(ctx);
}

function updatedOptions() {
    const newHideCursor = (<HTMLInputElement>document.getElementById("chkHideCursor")).checked;
    canvasContainer.style.cursor = newHideCursor ? "none" : "inherit";

    const newHoleRadius = parseFloat((<HTMLInputElement>document.getElementById("sldHoleRadius")).value) * devicePixelRatio;
    const newForceRadius = Math.max(newHoleRadius, parseFloat((<HTMLInputElement>document.getElementById("sldForceRadius")).value) * devicePixelRatio);

    if (newHoleRadius != gravityHoleRadius || newForceRadius != gravityForceRadius) {
        gravityHoleRadius = newHoleRadius;
        gravityForceRadius = newForceRadius;
        drawCanvasGravityHud();
    }
}

updatedOptions();