import { Link } from "react-router-dom";
import { Badge, Icon, PageHeader, buttonClassName } from "../components";
import "./pricing.css";

interface PricingTier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

// Placeholder pricing — billing is not wired up yet. Tiers are presentational.
const TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$0",
    cadence: "/mo",
    description: "Explore the studios with a small monthly generation allowance.",
    features: ["1 workspace", "50 generations / mo", "Catalogue images", "Community support"],
    cta: "Get started",
  },
  {
    id: "growth",
    name: "Growth",
    price: "$49",
    cadence: "/mo",
    description: "For brands shipping product creative across paid and organic.",
    features: [
      "3 workspaces",
      "1,000 generations / mo",
      "Product videos & on-model",
      "Priority queue",
    ],
    cta: "Upgrade to Growth",
    featured: true,
  },
  {
    id: "scale",
    name: "Scale",
    price: "Custom",
    cadence: "",
    description: "Volume generation, SSO, and dedicated support for teams.",
    features: [
      "Unlimited workspaces",
      "Custom generation volume",
      "SSO & roles",
      "Dedicated support",
    ],
    cta: "Contact sales",
  },
];

export function PricingPage() {
  return (
    <div className="route-view">
      <PageHeader
        title="Pricing"
        subtitle="Simple plans that scale with your creative output. Billing is coming soon."
      />

      <div className="pricing-grid">
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`pricing-card${tier.featured ? " pricing-card--featured" : ""}`}
          >
            <div className="pricing-card__head">
              <h2 className="pricing-card__name">{tier.name}</h2>
              {tier.featured ? <Badge>Most popular</Badge> : null}
            </div>
            <p className="pricing-card__price">
              <span className="pricing-card__amount">{tier.price}</span>
              {tier.cadence ? <span className="pricing-card__cadence">{tier.cadence}</span> : null}
            </p>
            <p className="pricing-card__desc">{tier.description}</p>
            <ul className="pricing-card__features">
              {tier.features.map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={14} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              to="/dashboard"
              className={`${buttonClassName(tier.featured ? "primary" : "secondary", "md")} pricing-card__cta`}
            >
              {tier.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
