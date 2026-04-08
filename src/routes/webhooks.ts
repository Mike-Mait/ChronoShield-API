import { FastifyInstance } from "fastify";
import { config } from "../config/env";
import { upgradeToProByEmail, downgradeToFreeByStripeCustomerId } from "./keys";

export async function webhooksRoute(app: FastifyInstance) {
  // Capture raw body for Stripe signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req: any, body: string, done: (err: Error | null, body?: any) => void) => {
      done(null, body);
    }
  );

  app.post(
    "/api/webhooks/stripe",
    {
      schema: { hide: true },
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

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as string,
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
            await upgradeToProByEmail(email, customerId);
            request.log.info({ email, customerId }, "User upgraded to Pro tier");
          } else {
            request.log.warn({ sessionId: session.id }, "checkout.session.completed missing email");
          }
          break;
        }

        case "customer.subscription.deleted": {
          const customerId = event.data.object.customer;
          const downgraded = await downgradeToFreeByStripeCustomerId(customerId);
          request.log.info(
            { customer: customerId, downgraded },
            "Subscription cancelled — downgraded to free tier"
          );
          break;
        }

        case "charge.refunded": {
          const customerId = event.data.object.customer;
          const downgraded = await downgradeToFreeByStripeCustomerId(customerId);
          request.log.info(
            { customer: customerId, downgraded },
            "Charge refunded — downgraded to free tier"
          );
          break;
        }

        case "invoice.payment_failed": {
          const customerId = event.data.object.customer;
          const downgraded = await downgradeToFreeByStripeCustomerId(customerId);
          request.log.info(
            { customer: customerId, downgraded },
            "Payment failed — downgraded to free tier"
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
