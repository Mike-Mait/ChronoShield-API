import { FastifyInstance } from "fastify";
import { config } from "../config/env";
import { upgradeToProByEmail } from "./keys";

export async function webhooksRoute(app: FastifyInstance) {
  app.post(
    "/api/webhooks/stripe",
    {
      schema: { hide: true },
      config: { rawBody: true },
    },
    async (request, reply) => {
      if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
        return (reply as any).code(500).send({
          error: "Stripe not configured",
          code: "STRIPE_NOT_CONFIGURED",
          message: "Payment processing is not available.",
        });
      }

      const stripe = require("stripe")(config.stripeSecretKey);
      const sig = request.headers["stripe-signature"];

      // Access raw body — we'll pass it via the rawBody plugin or use the body directly
      const rawBody =
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          sig,
          config.stripeWebhookSecret
        );
      } catch (err: any) {
        request.log.error(err, "Stripe webhook signature verification failed");
        return (reply as any).code(400).send({
          error: "Webhook signature verification failed",
          code: "WEBHOOK_ERROR",
          message: err.message,
        });
      }

      request.log.info({ type: event.type }, "Stripe webhook received");

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const email = session.metadata?.email || session.customer_email;
          const customerId = session.customer;

          if (email) {
            upgradeToProByEmail(email, customerId);
            request.log.info({ email }, "User upgraded to Pro tier");
          }
          break;
        }

        case "customer.subscription.deleted": {
          request.log.info(
            { customer: event.data.object.customer },
            "Subscription cancelled"
          );
          break;
        }

        default:
          request.log.info({ type: event.type }, "Unhandled Stripe event");
      }

      return reply.send({ received: true });
    }
  );
}
