// 결제 승인 Edge Function
//
// 왜 이게 필요한가:
//   토스 결제는 사용자가 결제창에서 인증을 마쳐도 아직 돈이 안 빠져나간다.
//   서버가 "승인(confirm) API" 를 호출해야 실제 결제가 완료된다.
//   이 API 는 시크릿 키로 인증하는데, 시크릿 키를 브라우저에 두면 누구나 훔쳐볼 수 있다.
//   GitHub Pages 는 정적 호스팅이라 서버가 없으므로, 이 Edge Function 이 서버 역할을 한다.
//
// 이 함수가 막는 공격:
//   1) 금액 위조 — 5만원짜리를 100원에 결제 요청하는 것
//   2) 남의 주문 승인 — 다른 사람의 orderId 로 승인을 시도하는 것
//   3) 중복 승인 — 이미 결제된 주문을 다시 승인하는 것

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ message: "POST 만 허용됩니다." }, 405);

  const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!TOSS_SECRET_KEY || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ message: "서버 환경변수가 설정되지 않았습니다." }, 500);
  }

  // ---- 입력 파싱 ----------------------------------------------------------
  let paymentKey: string, orderId: string, amount: number;
  try {
    const body = await req.json();
    paymentKey = String(body.paymentKey ?? "");
    orderId = String(body.orderId ?? "");
    amount = Number(body.amount);
  } catch {
    return json({ message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  if (!paymentKey || !orderId || !Number.isInteger(amount) || amount <= 0) {
    return json({ message: "paymentKey · orderId · amount 가 필요합니다." }, 400);
  }

  // ---- 1. 요청한 사람이 누구인지 확인 ---------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ message: "로그인이 필요합니다." }, 401);
  }
  const userId = userData.user.id;

  // service_role 클라이언트는 RLS 를 우회한다. 주문 상태를 바꿀 수 있는 유일한 통로.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- 2. 주문 조회 --------------------------------------------------------
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, user_id, product_id, quantity, amount, status, products(price)")
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderErr) return json({ message: "주문 조회에 실패했습니다." }, 500);
  if (!order) return json({ message: "존재하지 않는 주문입니다." }, 404);

  // ---- 3. 본인 주문인지 확인 (남의 주문 승인 차단) ---------------------------
  if (order.user_id !== userId) {
    return json({ message: "본인의 주문이 아닙니다." }, 403);
  }

  // ---- 4. 중복 승인 차단 ---------------------------------------------------
  if (order.status === "PAID") {
    return json({ ok: true, alreadyPaid: true, message: "이미 결제가 완료된 주문입니다." });
  }
  if (order.status !== "PENDING") {
    return json({ message: "결제를 진행할 수 없는 주문 상태입니다." }, 409);
  }

  // ---- 5. 금액 검증 (이 프로젝트에서 가장 중요한 부분) -----------------------
  // 브라우저가 보낸 amount 를 믿지 않고, DB 의 상품 가격 × 수량으로 다시 계산한다.
  const product = order.products as unknown as { price: number } | null;
  if (!product) return json({ message: "상품 정보를 찾을 수 없습니다." }, 500);

  const expected = product.price * order.quantity;
  if (expected !== amount || expected !== order.amount) {
    await admin.from("orders")
      .update({ status: "FAILED", toss_raw: { reason: "AMOUNT_MISMATCH", expected, received: amount } })
      .eq("id", order.id);
    return json({ message: "결제 금액이 상품 가격과 일치하지 않습니다." }, 400);
  }

  // ---- 6. 토스 승인 API 호출 ------------------------------------------------
  const basic = btoa(TOSS_SECRET_KEY + ":");
  let tossRes: Response, toss: Record<string, unknown>;
  try {
    tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    toss = await tossRes.json();
  } catch {
    return json({ message: "결제사 연결에 실패했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }

  // ---- 7. 결과 기록 --------------------------------------------------------
  if (!tossRes.ok) {
    await admin.from("orders")
      .update({ status: "FAILED", toss_raw: toss })
      .eq("id", order.id);
    return json({ message: (toss.message as string) ?? "결제 승인에 실패했습니다.", code: toss.code }, 400);
  }

  const { error: updateErr } = await admin.from("orders")
    .update({
      status: "PAID",
      payment_key: paymentKey,
      paid_at: new Date().toISOString(),
      toss_raw: toss,
    })
    .eq("id", order.id);

  if (updateErr) {
    // 결제는 됐는데 DB 기록에 실패한 경우 — 사용자에게 알리고 로그로 남긴다.
    console.error("결제 승인 후 DB 갱신 실패", { orderId, updateErr });
    return json({ message: "결제는 완료됐지만 기록 저장에 실패했습니다. 고객센터에 문의해 주세요." }, 500);
  }

  return json({ ok: true, orderId, amount, method: toss.method ?? null });
});
