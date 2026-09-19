import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Badge, BrandLockup, BrandMark, Card, Icon, buttonClassName } from "../components";
import { SERVICE_TYPES } from "../lib/generation-options";
import "./public.css";

const WORKFLOW = [
  {
    icon: "products" as const,
    title: "Add your product",
    body: "Create your products, then attach real product photos.",
  },
  {
    icon: "layers" as const,
    title: "Add the product",
    body: "Upload product images and details once so every render stays accurate to the real thing.",
  },
  {
    icon: "create" as const,
    title: "Configure the brief",
    body: "Pick a format, model mode, and aspect ratio. Review the generated prompt plan before you run.",
  },
  {
    icon: "generations" as const,
    title: "Generate & track",
    body: "Watch durable AI workflows progress step by step, then download campaign-ready creative.",
  },
];

const BENEFITS = [
  {
    icon: "brand" as const,
    title: "Product fidelity first",
    body: "Image-grounded descriptions and fidelity rules keep the product faithful — no drifting logos or invented details.",
  },
  {
    icon: "workspace" as const,
    title: "Built for teams",
    body: "Workspaces, roles, and a shared asset library keep collaborators working from one source.",
  },
  {
    icon: "clock" as const,
    title: "Durable workflows",
    body: "Long-running generations are trackable and retryable — nothing is lost mid-run.",
  },
];

const TAGLINES = [
  "From product shot to sold-out ad in minutes.",
  "Your catalogue, reimagined by AI — pixel-faithful, every time.",
  "Stop paying for reshoots. Start generating them.",
  "The studio that never sleeps, never drifts off-brand.",
];

function RotatingTagline() {
  return (
    <p className="hero__tagline" aria-live="polite">
      {TAGLINES.map((line, index) => (
        <span
          key={line}
          className="hero__tagline-text"
          style={{ animationDelay: `${index * 3}s` }}
        >
          {line}
        </span>
      ))}
    </p>
  );
}

function HeroBackdrop() {
  const sparks = [
    { top: "18%", left: "58%", delay: "0s" },
    { top: "62%", left: "84%", delay: "0.6s" },
    { top: "40%", left: "12%", delay: "1.2s" },
    { top: "78%", left: "36%", delay: "1.8s" },
    { top: "10%", left: "30%", delay: "2.4s" },
    { top: "50%", left: "70%", delay: "3s" },
  ];
  return (
    <>
      <div className="hero__auras" aria-hidden="true">
        <span className="hero__aura hero__aura--1" />
        <span className="hero__aura hero__aura--2" />
        <span className="hero__aura hero__aura--3" />
        <span className="hero__sweep" />
      </div>
      <div className="hero__sparks" aria-hidden="true">
        {sparks.map((s, i) => (
          <span
            key={i}
            className="hero__spark"
            style={{ top: s.top, left: s.left, animationDelay: s.delay }}
          />
        ))}
      </div>
    </>
  );
}

function PublicNav() {
  return (
    <nav className="public-nav">
      <span className="public-brand">
        <BrandMark size={28} />
        RagGen
      </span>
      <div className="public-nav__actions">
        <Link className={buttonClassName("ghost", "sm")} to="/login">
          Log in
        </Link>
        <Link className={buttonClassName("primary", "sm")} to="/register">
          Get started
        </Link>
      </div>
    </nav>
  );
}

export function LandingPage() {
  const { status } = useAuth();
  if (status === "authenticated") return <Navigate to="/dashboard" replace />;

  return (
    <div className="public">
      <PublicNav />

      <header className="hero">
        <HeroBackdrop />
        <div className="hero__inner">
          <div>
            {/* Title card: the lockup introduces the product before the headline does. */}
            <BrandLockup size={44} className="hero__lockup" />
            <span className="hero__eyebrow">
              <Icon name="sparkle" size={13} />
              AI catalogue creative
            </span>
            <h1 className="hero__title">
              Turn product photos into <em>catalogue-ready</em> images, on-model shots, and videos.
            </h1>
            <p className="hero__lead">
              Build your catalogue, attach real product photos, and generate on-brand creative with
              durable, trackable AI workflows — without losing product accuracy.
            </p>
            <RotatingTagline />

            <div className="hero__flow" aria-hidden="true">
              <span className="hero__flow-step">
                <span className="icon-chip">
                  <Icon name="products" size={15} />
                </span>
                Product assets
              </span>
              <Icon name="arrow-right" size={16} className="hero__flow-arrow" />
              <span className="hero__flow-step">
                <span className="icon-chip">
                  <Icon name="create" size={15} />
                </span>
                AI workflow
              </span>
              <Icon name="arrow-right" size={16} className="hero__flow-arrow" />
              <span className="hero__flow-step">
                <span className="icon-chip">
                  <Icon name="generations" size={15} />
                </span>
                Creative
              </span>
            </div>

            <div className="hero__cta">
              <Link className={buttonClassName("primary", "lg")} to="/register">
                Create your free account
              </Link>
              <Link className={buttonClassName("secondary", "lg")} to="/login">
                Log in
              </Link>
            </div>
          </div>

          <div className="hero__stage" aria-hidden="true">
            <div className="hero__panel hero__panel--back" />
            <div className="hero__panel hero__panel--main">
              <div className="hero__chip-row">
                <Badge tone="accent">PRODUCT_VIDEO_AD</Badge>
                <Badge tone="running">Running</Badge>
              </div>
              <div className="hero__preview" style={{ position: "relative" }}>
                <Icon name="play" size={26} />
                <span className="hero__preview-badge">
                  <Badge>9:16</Badge>
                </span>
              </div>
              <div className="hero__mini-bar" style={{ width: "70%" }} />
              <div className="hero__mini-bar" style={{ width: "45%" }} />
            </div>
          </div>
        </div>
      </header>

      <section className="public-section">
        <div className="public-section__head">
          <span className="public-section__eyebrow">How it works</span>
          <h2 className="public-section__title">From product to creative in four steps</h2>
          <p className="public-section__lead">
            A focused production flow that keeps your product the source of truth at every stage.
          </p>
        </div>
        <div className="workflow-grid">
          {WORKFLOW.map((step, index) => (
            <div className="workflow-step" key={step.title}>
              <span className="workflow-step__num">0{index + 1}</span>
              <span className="workflow-step__icon">
                <Icon name={step.icon} size={20} />
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="public-section">
        <div className="public-section__head">
          <span className="public-section__eyebrow">Generation modes</span>
          <h2 className="public-section__title">One workspace, every format</h2>
        </div>
        <div className="mode-grid">
          {SERVICE_TYPES.map((mode) => (
            <Card key={mode.value} padding="lg">
              <span className="benefit__icon" style={{ marginBottom: "var(--sp-3)" }}>
                <Icon name={mode.icon} size={18} />
              </span>
              <h3 style={{ fontSize: "var(--fs-card)" }}>{mode.label}</h3>
              <p
                style={{
                  marginTop: "var(--sp-2)",
                  color: "var(--text-muted)",
                  fontSize: "var(--fs-support)",
                }}
              >
                {mode.description}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="public-section">
        <div className="public-section__head">
          <span className="public-section__eyebrow">Why RagGen</span>
          <h2 className="public-section__title">Designed for accuracy and scale</h2>
        </div>
        <div className="benefit-grid">
          {BENEFITS.map((benefit) => (
            <div className="benefit" key={benefit.title}>
              <span className="benefit__icon">
                <Icon name={benefit.icon} size={18} />
              </span>
              <h3>{benefit.title}</h3>
              <p>{benefit.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>Start generating catalogue creative today</h2>
        <p>Create a workspace, add a product, and run your first generation in minutes.</p>
        <Link className={buttonClassName("primary", "lg")} to="/register">
          Create your free account
        </Link>
      </section>

      <footer className="public-footer">
        RagGen — AI product image &amp; video generation.
      </footer>
    </div>
  );
}
