---
title: "Quarkus + GraalVM Advanced Obfuscation"
subtitle: "How to open-source your runtime without open-sourcing your IP"
slug: quarkus-graalvm-advanced-obfuscation
summary: "GraalVM 25 Advanced Obfuscation can turn Quarkus native images into a practical distribution boundary - if you avoid -H:Preserve and use conditional reflection metadata instead. A reproducible walkthrough with CDI, Fault Tolerance, Redis, and Hibernate."
description: "How I made Oracle GraalVM 25 Advanced Obfuscation work with a real Quarkus service: why -H:Preserve breaks Quarkus native builds, how invert-target reflect-config keeps SmallRye Fault Tolerance / Arjuna / Vert.x names without force-including the classpath, and what that enables for distributing opaque Community runtimes."
published: 2026-09-21
updated: 2026-09-21
author: Andrew Eells
tags: [quarkus, graalvm, native-image, obfuscation, java, open-source]
---

I've spent the last 18 months building [Backbone](https://backbonehq.io/), a production platform bootstrap for SaaS startup engineering teams.

I recently open-sourced the Community edition. Community is meant to be genuinely usable for local development: run the platform services, scaffold product domain services, build against a real runtime. What I *didn't* want to do is open source the entire codebase.

That's an awkward distribution problem. Java bytecode is a weak boundary. Even without source, a normal JVM artifact still leaves a lot of useful structure behind.

GraalVM Native Image already helps: you ship machine code, not class files, and closed-world analysis strips unreachable code. GraalVM 25 adds another layer - Advanced Obfuscation (AO) - which replaces meaningful module, package, class, method, field, and source-file names with opaque symbols across application code and third-party dependencies.

The interesting question was never "does `-H:AdvancedObfuscation` work on Hello World?"

It was whether AO would survive a real Quarkus service.

I couldn't find a public write-up of anyone getting that working with a CDI-heavy Quarkus stack, so I tried it. The working reproduction is here:

[github.com/get-backbone/quarkus-graalvm-ao](https://github.com/get-backbone/quarkus-graalvm-ao)

## The problem

Backbone Community needs runnable platform services. Users should be able to start auth, actor, notification, and document locally - not inherit a crippled source-only stub - and build their own domain services against that runtime. When they're ready to ship, a commercial licence unlocks the rest: full source code access to modify the backing services, CI/CD release pipelines, infrastructure automation, AWS deployments, security, scale, and compliance features.

But Community isn't the production platform. Extending core services and deploying to AWS sit behind that licence. The open surface is the local toolchain, domain-service scaffolding, SDK APIs, and the runnable platform images. The proprietary service implementations stay closed.

So the distribution model I wanted looked like this:

```text
Private service source (IP)
        │
        ▼
Quarkus native build (Oracle GraalVM 25)
        │
        ▼
Advanced Obfuscation
        │
        ▼
Opaque Linux native image
        │
        ▼
Public Community distribution (development-only)
```

AO is only the binary distribution boundary. Community still needs a signed licence, and the platform adds its own integrity and entitlement checks - so the free tier stays something you develop against, not a way to run production for free.

AO turns native compilation from "just a deployment format" into a practical **distribution boundary**. Not a security boundary. Not DRM. A skilled attacker with time and the right tools can still reverse-engineer native binaries - but that's a different bar from unzipping a JAR and reading class files. "Here is a runnable service whose implementation isn't sitting there as readable Java" is a much more useful open-source story for a commercial platform product than a stripped demo.

## First attempt: build succeeded, Quarkus died

AO is experimental and Oracle-GraalVM-only. Quarkus's native ecosystem is Mandrel-first, so this isn't a well-trodden path.

I pointed a real service at Oracle GraalVM 25 with:

```text
-H:AdvancedObfuscation=export-mapping
```

The native build completed. Startup then fell over inside SmallRye Fault Tolerance with an NPE. The stack trace was partially obfuscated, which made the evening more educational than it needed to be :/

`export-mapping` produces a JSON map from original names to obfuscated ones (and lets you deobfuscate stack traces later). That was enough to see what was going on: AO isn't just cosmetic for anyone poking at the binary with a disassembler. Anything that depends on runtime names - `Class#getName()`, reflective lookup, CDI bean resolution, FT frames - can change behaviour when those names change.

## `-H:Preserve` looked right but wasn't

[Oracle's docs](https://docs.oracle.com/en/graalvm/jdk/25/docs/security-guide/native-image/obfuscation/) point at `-H:Preserve` as the carve-out.

On a Quarkus classpath, Preserve is the wrong tool.

Preserve is a **reachability** mechanism as well as a rename exclusion. Broad package preservation started dragging optional and otherwise-unreachable types into the image - logging bridges, Kotlin metadata, MicroProfile Metrics, deployment classes, and friends. The build then failed with missing classes. Narrower Preserve lists still pulled optionals in.

I wanted:

> If this type is already reachable, keep its name.

Preserve gave me:

> Make this code available even if analysis didn't find it, *and* don't rename it.

For Quarkus, that second behaviour felt like a bit of a sledgehammer.

## The fix: invert-target reflection metadata

GraalVM's AO rules are clearer once you look for them: classes registered for reflection in reachability metadata aren't obfuscated. Reflection registration is rename protection. It isn't, by itself, a force-include of the whole package.

The pattern that worked was conditional `reflect-config.json` entries - what I ended up calling invert-target registrations:

```json
{
  "name": "io.smallrye.faulttolerance.…",
  "condition": {
    "typeReachable": "io.smallrye.faulttolerance.…"
  }
}
```

If the type is reachable, AO leaves the name alone. If it isn't reachable, the registration is a no-op and doesn't suddenly pull half of Quarkus into the image.

That distinction - Preserve vs conditional reflection - was the entire unlock.

## It didn't stop at Fault Tolerance

Once FT started cleanly, other name-sensitive framework edges showed up.

| Symptom                                              | What fixed it                                                                             |
|------------------------------------------------------|-------------------------------------------------------------------------------------------|
| SmallRye FT NPE / mangled FT frames                  | FT invert-target generator                                                                |
| `NoSuchMethodException` on Arjuna `*EnvironmentBean` | Narrow Arjuna suffix allowlist (blanket `com.arjuna.**` OOMed / timed out the AO compile) |
| CDI `No bean found` for an obfuscated Vert.x type    | Redis / Mutiny Vert.x invert-target generator                                             |
| Micrometer Vert.x binder NPE under AO                | `quarkus.micrometer.binder.vertx.enabled=false`                                           |

The Quarkus runtime under test was Quarkus **3.36.1** on Oracle GraalVM **25**, running a production-like stack:

- Quarkus ArC CDI
- SmallRye Fault Tolerance
- Redis cache
- Postgres/Hibernate
- SmallRye Health + Micrometer/Prometheus
- [backbone-kit](https://github.com/get-backbone/backbone-kit) metrics, logging, throttle components

I used small generators to rebuild the three reflect carve-outs before each AO build; the Linux/glibc native image comes out of Oracle GraalVM 25 with Advanced Obfuscation enabled.

Build time is the main cost. An AO native build of a Backbone service took around 20 minutes. Oracle documents AO as typically adding ~20–50% to native-image time, with no runtime performance or memory overhead.

## What ships

Community platform services are distributed as protected native images on GHCR.

You can pull and run them locally with the [Community edition of Backbone](https://github.com/get-backbone/backbone-community). The proprietary Java source doesn't come with them.

The same approach is documented end-to-end in the demo public repo so anyone can reproduce the mechanism, without needing the full Backbone tree:

[get-backbone/quarkus-graalvm-ao](https://github.com/get-backbone/quarkus-graalvm-ao)

```bash
task compose:up
task test          # JVM path
task ao:build      # regenerates reflect-config, then AO native (~15m)
task ao:image
task ao:run
task ao:smoke
```

## Caveats worth saying out loud

AO is experimental and Oracle-GraalVM-only. Behaviour can shift between releases; pin versions and test the obfuscated image.

AO isn't encryption, and it doesn't make reverse engineering impossible. It does turn "read the implementation" into specialist native-binary work - Ghidra/IDA territory, opaque symbols, closed-world stripping - rather than an afternoon with a Java decompiler.

Keep the mapping file with the build so you can deobfuscate production stack traces. Don't ship it in the image.

Watch the SBOM. [Oracle warns](https://docs.oracle.com/en/graalvm/jdk/25/docs/security-guide/native-image/obfuscation/) that embedded class-level SBOM data can re-expose original symbol names under AO; export the SBOM or disable embedding when confidentiality matters.

And one extra Quarkus footgun just for fun: CLI `-Dquarkus.native.additional-build-args=…` **replaces** the property rather than merging with it. If you also need `--initialize-at-run-time=…` (I did for `jansi`), put both flags on the same CLI list, or you'll silently drop one.

## What this enables for Backbone

```text
Community (free, development-only)
    ├── local Floci / Postgres / Redis backends
    ├── AO native platform services (auth, actor, notification, document)
    ├── domain-service scaffolding (auth, throttling, logging, metrics baked in)
    ├── BFF API + stateless reference UI (Quarkus dev mode)
    └── open SDK surface + local tooling
              │
              │  licence when ready to ship
              ▼
         source code + CI/CD + IaC + AWS deploy + enterprise scale, security, compliance concerns
```

Users get something they can actually run and build against. They don't get the commercial platform implementation as public Java source just because Community distribution is public.

That's a much more valuable open-source boundary for this kind of product than a sales demo or video pitch before upgrading.

## Takeaway

What's missing from the Oracle Advanced Obfuscation docs is an account of making AO work with a real Quarkus application - including CDI and SmallRye Fault Tolerance - without resorting to `-H:Preserve` and watching the native build eat optional dependencies.

The short version:

> **Don't preserve Quarkus. Register the few name-sensitive types with conditional reflection metadata, and let AO rename everything else.**

Start here if you're about to spend a day discovering that the hard way:

**[get-backbone/quarkus-graalvm-ao](https://github.com/get-backbone/quarkus-graalvm-ao)**

[![Quarkus](https://img.shields.io/badge/Quarkus-3.36.1-4695EB?logo=quarkus&logoColor=white)](https://quarkus.io/)

[![GraalVM](https://img.shields.io/badge/GraalVM-25-F2A900?logo=oracle&logoColor=white)](https://www.graalvm.org/jdk25/security-guide/native-image/obfuscation/)
