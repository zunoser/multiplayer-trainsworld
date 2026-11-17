# Company competition

Competitive rooms start from an empty world with $10 billion per company. Up to five companies operate independent networks on the same map and demand. The finance tab ranks cash and cumulative operating profit (fares minus running and maintenance costs). There is no time limit or final winner.

The server associates a browser's saved company key with its company. A different browser creates another company unless it imports that company's backup. All companies remain reserved until the room expires, even when disconnected. Rooms expire seven days after the last join. Host handover, checkpoints and a new Durable Object runtime preserve ownership and accounts.

Construction quotes include only the company's enabled blueprint and additional vehicles after its own spare fleet. Construct all leaves disabled pieces and other companies' assets unchanged. Companies can inspect opponents' networks but cannot edit or connect to them. Global undo, redo, borrowing, fares, line groups, ferries and station building outlines are unavailable in competition. Cooperative rooms retain their existing controls.

Native edits also protect other companies' track, nodes, station inputs, line inputs and attachment points. A station sweep, split, move or automatically planned line that would change or use another company's infrastructure is rolled back before spending or undo history changes. Drawing tools snap to the player's assets. Inspectors identify the owner and disable other companies' editing controls.

## Back up and restore

The room bar's save button downloads a company-room JSON backup containing the last confirmed world checkpoint, subsequent operations, all company accounts and ownership, and the downloading player's company recovery key. Unconfirmed edits are excluded. Keep this file private: its recovery key gives access to that company. Other players' raw recovery keys are never included.

In the lobby, choose Restore company room and select the backup. Starting the host creates a new room, restores the downloading player's company and all confirmed state, and leaves the clock paused. Share the new room code with the other players. Players joining from their original browser recover their company automatically. On another device, select Recover my company in the Join tab and import that player's own backup before joining. Each player should keep their own backup if they need device recovery. The old room remains independent.

Backups support up to 8 MiB. Invalid backups are rejected before replacing room state. Ordinary world files from the solo save panel remain solo map exports and do not include competitive accounts or recovery keys.

## Coordination and verification

Ownership updates in command results contain changes only. Periodic account updates omit ownership; checkpoints retain the full ownership needed for replay. Legacy full-state events remain readable.

Local Miniflare verification with 10,000 owned assets kept ten committed event packets below 1 KiB and observed complete result-to-commit round trips below 25 ms. The five-company wire-codec fixture reduced a representative full result from 479,259 bytes to 1,548 bytes. These are local coordination measurements; the browser still owns simulation work. The Worker configuration retains its 50 ms CPU budget.

The host browser runs the simulation and is trusted to report results. This mode is intended for cooperative groups competing with separate companies; it does not provide server-authoritative anti-cheat. There is no fixed round length or final winner: the standings compare cumulative operating profit, then cash.
