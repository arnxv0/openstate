import type { WithId } from "mongodb";
import { eventsCollection, formatClock, type EventDoc } from "@/lib/events-repo";
import type { EventType } from "@/lib/types";

// Things that were seen or that people asked to be remembered. Questions and
// earlier answers are deliberately left out: fed back as "memories", one
// stale or wrong answer gets repeated as fact from then on.
const RECALLABLE: EventType[] = ["memory", "observation", "context", "transition", "location"];

type Recalled = {
  when: string;
  type: string;
  observerId?: string;
  text: string;
};

function toRecalled(doc: WithId<EventDoc>): Recalled {
  return {
    when: `${doc.ts.toISOString().slice(0, 10)} ${formatClock(doc.ts)}`,
    type: doc.type,
    observerId: doc.observerId,
    text: doc.summary,
  };
}

export async function retrieveMemories(query: string, limit = 6) {
  const events = await eventsCollection();
  const vector = {
    $vectorSearch: {
      index: "events_semantic",
      path: "summary",
      query,
      numCandidates: 100,
      limit: limit * 2,
      filter: { type: { $in: RECALLABLE } },
    },
  };

  let mode: "hybrid" | "vector" | "recent" = "hybrid";
  let docs: WithId<EventDoc>[] = [];
  try {
    docs = await events
      .aggregate<WithId<EventDoc>>([
        {
          $rankFusion: {
            input: {
              pipelines: {
                vector: [vector],
                text: [
                  {
                    $search: {
                      index: "events_text",
                      text: { query, path: ["summary", "title"] },
                    },
                  },
                  { $match: { type: { $in: RECALLABLE } } },
                  { $limit: limit * 2 },
                ],
              },
            },
            combination: { weights: { vector: 0.7, text: 0.3 } },
          },
        },
        { $limit: limit },
      ])
      .toArray();
  } catch {
    mode = "vector";
    try {
      docs = await events
        .aggregate<WithId<EventDoc>>([vector, { $limit: limit }])
        .toArray();
    } catch {
      // Search indexes still building (or Atlas Search unavailable): answer
      // from the most recent events rather than failing the whole request.
      mode = "recent";
    }
  }

  const recent = await events
    .find({ type: { $in: RECALLABLE } })
    .sort({ ts: -1 })
    .limit(4)
    .toArray();

  const seen = new Set<string>();
  const memories = [...docs, ...recent]
    .filter((doc) => {
      const id = doc._id.toHexString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(toRecalled);

  return { mode, memories };
}
