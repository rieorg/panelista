import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 py-4 text-[15px] leading-relaxed">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p className="text-muted">Last updated: October 20, 2026</p>
      <p>
        Panelista is a free community app that connects capstone students with professionals who volunteer to evaluate their
        systems. We follow the Philippine Data Privacy Act of 2012 (RA 10173) and collect only what the app needs.
      </p>
      <h2 className="text-xl font-bold">What we collect</h2>
      <ul className="list-disc pl-6">
        <li>Your Google account name, email and photo when you sign in. Your email is never shown to other users.</li>
        <li>
          We email you about your own requests only: a new request, an answer, and when it expires. Evaluators who let
          requests expire are set to Away.
        </li>
        <li>What you type into your profile, projects, chats and reviews. Profiles, projects and reviews are public.</li>
        <li>Chats are visible only to the two people in the request (and to the admin when a report is investigated).</li>
        <li>Verification files you upload. Only the admin can open them, and they are deleted after review.</li>
      </ul>
      <h2 className="text-xl font-bold">What we never do</h2>
      <ul className="list-disc pl-6">
        <li>Sell or share your data with advertisers.</li>
        <li>Ask for payment. Panelista is free; report anyone who asks you for money.</li>
      </ul>
      <h2 className="text-xl font-bold">Where it is stored</h2>
      <p>Google Firebase (Auth and Firestore), Vercel (the website) and Cloudflare Workers KV (verification files).</p>
      <h2 className="text-xl font-bold">Your rights</h2>
      <p>
        You can edit your profile any time. To delete your account and data, email{" "}
        <a className="text-brand underline" href="mailto:eirmonpaculan11@gmail.com">
          eirmonpaculan11@gmail.com
        </a>{" "}
        from the Google account you used, and we will delete it within 7 days.
      </p>
    </article>
  );
}
