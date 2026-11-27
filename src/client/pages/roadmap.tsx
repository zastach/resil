import ResilBrand from '@/components/ResilBrand';
import { IconCurrency, IconFlag, IconPhoto, IconShield, IconSwords, IconUsers } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import styles from './roadmap.module.css';

const stages = [
  {
    title: 'Available now',
    entries: [
      {
        title: '/sil Image Hosting',
        icon: IconPhoto,
        summary: 'Get your images ready for Rust signs.',
        detail:
          'Upload an image, choose an in-game sign, and preview how it should look. Save the original, the /sil-ready version, or both.',
        link: { to: '/auth/image-guide', label: 'View sign dimensions' },
      },
      {
        title: 'NPC Studio',
        icon: IconUsers,
        summary: 'Custom characters for the RE world.',
        detail:
          'Staff can create NPCs with custom clothing, branching conversations, dialogue logic, and voice audio.',
      },
    ],
  },
  {
    title: 'In development',
    entries: [
      {
        title: 'Community Raid Bases',
        icon: IconShield,
        summary: 'Build a base the whole server can raid.',
        detail:
          'Submit your build for feedback and a difficulty rating. The Raid Bases Panel can approve bases into rotation and vote on tier loot tables without staff approval. Players can also choose to risk their raid rewards for RP before starting.',
      },
      {
        title: 'Wagered Raids',
        icon: IconSwords,
        summary: 'Challenge another team with resources on the line.',
        detail:
          'Agree on a base, sides, stakes, and a time limit in RESil. Staff collect the stakes and start the event. After both sides get prep time, raiders win by destroying the TC before time runs out. Defenders win by keeping it intact.',
      },
      {
        title: '/siege',
        icon: IconFlag,
        summary: 'Sign up with your clan to raid a giant base together.',
        detail:
          'Multiple clans sign up for one massive raid in a large PvP zone. Work together to crack the base, and watch out for grubs looking to steal the loot.',
      },
    ],
  },
  {
    title: 'On the roadmap',
    entries: [
      {
        title: 'Player-Created NPCs',
        icon: IconUsers,
        summary: 'Bring your own characters into the world.',
        detail:
          'Build an NPC on RESil and submit it for approval and placement by staff. We’re exploring an NPC Panel that could review and place approved NPCs within tested limits.',
      },
      {
        title: 'Progress Across Wipes',
        icon: IconCurrency,
        summary: 'Earn access by playing across wipes.',
        detail:
          'We’re exploring more ways to exchange loot for RP, then trade RP for persistent experience. Experience and Discord roles could unlock access to community panels and more RESil tools.',
      },
      {
        title: 'RP Exceptions',
        icon: IconFlag,
        summary: 'Explore more options for player builds.',
        detail:
          'We’re exploring whether a Community Panel could handle requests like oversized items and deployables through RESil.',
      },
    ],
  },
];

export function Component() {
  return (
    <main className={styles.page}>
      <title>Community Roadmap | Rust Empires</title>
      <header className={styles.header}>
        <Link to='/auth/login'>
          <ResilBrand />
        </Link>
      </header>
      <div className={styles.content}>
        <div className={styles.hero}>
          <p>Rust Empires</p>
          <h1>Community Roadmap</h1>
          <div>Our mission is to be the most RP-friendly server in Rust.</div>
        </div>
        <p className={styles.intro}>
          See what you can use today and what we’re building next. Open a card for details.
        </p>
        <div className={styles.timeline}>
          {stages.map(({ title, entries }) => (
            <section key={title} className={styles.stage}>
              <h2>{title}</h2>
              {entries.map(({ title, icon: Icon, summary, detail, link }) => (
                <details key={title} className={styles.card}>
                  <summary>
                    <Icon size={22} aria-hidden />
                    <span>
                      <strong>{title}</strong>
                      <small>{summary}</small>
                    </span>
                    <span className={styles.expand} aria-hidden />
                  </summary>
                  <div className={styles.detail}>
                    <p>{detail}</p>
                    {link && <Link to={link.to}>{link.label} →</Link>}
                  </div>
                </details>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
