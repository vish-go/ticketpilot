import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { db, type Database } from "./db.js";
import { indexDocument } from "./knowledge.js";

/** Explicit development-only sample data. Existing accounts never have their password overwritten. */
export async function seed(database: Database): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seed is disabled in production");
  const password = process.env.DEMO_PASSWORD;
  const email = (
    process.env.DEMO_EMAIL || "demo@ticketpilot.local"
  ).toLowerCase();
  if (
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    throw new Error(
      "Set DEMO_PASSWORD to at least 12 characters and at most 72 UTF-8 bytes",
    );
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error("DEMO_EMAIL must be an email address");
  const passwordHash = await bcrypt.hash(password, 12);
  const organizationId = "a35d0e94-9c34-4250-8d4d-8cb48d702687";
  await database.transaction(async (tx) => {
    let user = (await tx.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
    if (user && !(await bcrypt.compare(password, user.password_hash)))
      throw new Error(
        "Existing demo account password differs; seed did not overwrite it",
      );
    if (!user) {
      user = { id: randomUUID() };
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [user.id, email, "Demo Agent", passwordHash],
      );
    }
    const organization = (
      await tx.query("SELECT id FROM organizations WHERE id=$1", [
        organizationId,
      ])
    ).rows[0];
    if (!organization) {
      await tx.query(
        "INSERT INTO organizations(id,name) VALUES($1,'TicketPilot Demo')",
        [organizationId],
      );
      await tx.query(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
        [organizationId, user.id],
      );
    } else {
      const member = (
        await tx.query(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
          [organizationId, user.id],
        )
      ).rows[0];
      if (member?.role !== "owner")
        throw new Error(
          "Demo workspace belongs to another account; refusing to alter ownership",
        );
    }
    const existing = (
      await tx.query("SELECT id FROM tickets WHERE org_id=$1 AND subject=$2", [
        organizationId,
        "Where is my delayed order?",
      ])
    ).rows[0];
    if (!existing) {
      const id = randomUUID();
      const body =
        "My delivery is delayed. Can you check the order tracking and explain the delivery policy?";
      await tx.query(
        `INSERT INTO tickets(id,org_id,created_by,subject,body,customer_email,category,response_due_at,resolution_due_at)
        VALUES($1,$2,$3,'Where is my delayed order?',$4,'customer@example.com','delivery',now()+interval '4 hours',now()+interval '2 days')`,
        [id, organizationId, user.id, body],
      );
      await tx.query(
        "INSERT INTO messages(id,org_id,ticket_id,author_name,body) VALUES($1,$2,$3,'customer@example.com',$4)",
        [randomUUID(), organizationId, id, body],
      );
      await tx.query(
        "INSERT INTO activities(id,org_id,ticket_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,'created','Development sample ticket')",
        [randomUUID(), organizationId, id, user.id],
      );
    }
    const document = (
      await tx.query("SELECT id FROM documents WHERE org_id=$1 AND title=$2", [
        organizationId,
        "Delivery policy — sample",
      ])
    ).rows[0];
    if (!document)
      await tx.query(
        "INSERT INTO documents(id,org_id,title,content) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          organizationId,
          "Delivery policy — sample",
          "For delayed deliveries, ask the customer for their order tracking number. Standard delivery takes 3 to 5 business days. If tracking has not updated for 48 hours, escalate the delivery to the shipping team. Do not promise a refund before reviewing the order.",
        ],
      );
  });
  const document = (
    await database.query(
      "SELECT * FROM documents WHERE org_id=$1 AND title=$2",
      [organizationId, "Delivery policy — sample"],
    )
  ).rows[0];
  if (document) {
    try {
      await indexDocument(database, organizationId, document);
      await database.query(
        "UPDATE documents SET index_status='indexed',index_error=NULL WHERE org_id=$1 AND id=$2 AND version=$3",
        [organizationId, document.id, document.version],
      );
    } catch {
      await database.query(
        "UPDATE documents SET index_status='failed',index_error='Demo policy indexing failed; retry indexing after checking provider configuration' WHERE org_id=$1 AND id=$2 AND version=$3",
        [organizationId, document.id, document.version],
      );
      throw new Error(
        "Sample account and ticket exist, but policy indexing failed. Check embedding configuration and rerun seed.",
      );
    }
  }
  console.log(
    "Development sample data is ready. Sign in using DEMO_EMAIL (default demo@ticketpilot.local) and your DEMO_PASSWORD.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await seed(db);
  } finally {
    await db.close();
  }
}
