import {
  isObserverId,
  phoneAnswer,
  phoneLeave,
  phonePoll,
  viewerOffer,
  viewerPoll,
} from "@/lib/signal-store";

type SignalBody =
  | {
      kind: "offer";
      viewer: string;
      offerId: string;
      phoneSession: string;
      sdp: string;
    }
  | {
      kind: "answer";
      session: string;
      viewer: string;
      offerId: string;
      sdp: string;
    };

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const session = params.get("session");
  const viewer = params.get("viewer");

  if (session) return Response.json(phonePoll(observer, session), noStore);
  if (viewer) return Response.json(viewerPoll(observer, viewer), noStore);
  return Response.json({ error: "missing session or viewer" }, { status: 400 });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }

  const body = (await request.json()) as SignalBody;
  const ok =
    body.kind === "offer"
      ? viewerOffer(observer, {
          viewer: body.viewer,
          offerId: body.offerId,
          phoneSession: body.phoneSession,
          offer: body.sdp,
        })
      : phoneAnswer(observer, body.session, body.viewer, body.offerId, body.sdp);

  return Response.json({ ok }, { status: ok ? 200 : 409 });
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  const session = new URL(request.url).searchParams.get("session");
  if (isObserverId(observer) && session) phoneLeave(observer, session);
  return Response.json({ ok: true });
}
