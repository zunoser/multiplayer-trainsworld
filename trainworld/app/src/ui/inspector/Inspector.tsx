import { competing, ownsAsset } from "../../game/companies";
// The inspector shows whatever is selected, and is blank when nothing is (SPEC 8).

import { selection } from "../../game/ui";
import { AchievementsView } from "./AchievementsView";
import { AllCitiesView } from "./AllCitiesView";
import { CityInspector } from "./CityInspector";
import { CommutersInspector } from "./CommutersInspector";
import { LineInspector } from "./LineInspector";
import { GroupInspector } from "./GroupInspector";
import { BusStopInspector } from "./BusStopInspector";
import { TripInspector } from "./TripInspector";
import { JunctionInspector } from "./JunctionInspector";
import { StationInspector } from "./StationInspector";
import { TrackInspector } from "./TrackInspector";
import { TrainInspector } from "./TrainInspector";
import { effect } from "@preact/signals";
import { linesById, stationsById, world } from "../../game/world";

// T-3333: a hidden twin's line picked (its train's chip, its track) is shown as the line it runs for
effect(() => {
  const s = selection.value, p = s?.kind === "line" ? world.value?.twins.get(s.line) : undefined;
  if (p) selection.value = { kind: "line", line: p };
});

export function Inspector() {
  const s = selection.value;
  let body = null;
  if (!s) body = null; // nothing selected: the area stays, empty
  else if (s.kind === "line") body = <LineInspector key={s.line} id={s.line} />;
  else if (s.kind === "group") body = <GroupInspector key={s.group} group={s.group} />;
  else if (s.kind === "busStop") body = <BusStopInspector key={s.lines.join()} lines={s.lines} stop={s.stop} />;
  else if (s.kind === "station") body = <StationInspector id={s.station} />;
  else if (s.kind === "train") body = <TrainInspector line={s.line} profile={s.profile} dep={s.dep} />;
  else if (s.kind === "track") body = <TrackInspector edge={s.edge} />;
  else if (s.kind === "junction") body = <JunctionInspector node={s.node} />;
  else if (s.kind === "commuters") body = <CommutersInspector />;
  else if (s.kind === "city") body = <CityInspector key={s.city} id={s.city} />;
  else if (s.kind === "world") body = <AllCitiesView />;
  else if (s.kind === "achievements") body = <AchievementsView />;
  else body = <TripInspector />;
  const w = world.value;
  const locked = competing.value && !!s && (
    s.kind === "group" ||
    ((s.kind === "line" || s.kind === "train") && !ownsAsset("line", w ? linesById(w).get(s.line)?.num : undefined)) ||
    (s.kind === "station" && !ownsAsset("node", w ? stationsById(w).get(s.station)?.num : undefined)) ||
    (s.kind === "track" && !ownsAsset("edge", s.edge)) ||
    (s.kind === "junction" && !ownsAsset("node", s.node)) ||
    (s.kind === "busStop" && s.lines.some(id => !ownsAsset("line", w ? linesById(w).get(id)?.num : undefined)))
  );
  return <section id="inspector">{locked ? <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} onDblClickCapture={e => e.stopPropagation()}>{body}</fieldset> : body}</section>;
}
