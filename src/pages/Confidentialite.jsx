export default function Confidentialite() {
  return (
    <div className="legal">
      <div className="legal-card">
        <img src="/logo.png" alt="Plomberie Instant" className="legal-logo" />
        <h1>Politique de confidentialité</h1>
        <p className="legal-date">Dernière mise à jour : 29 juin 2026</p>

        <p>
          La présente politique décrit comment <strong>Plomberie Instant inc.</strong>{" "}
          (« nous ») recueille, utilise et protège les renseignements dans le cadre
          de l'utilisation de son portail de gestion (l'« Application »).
        </p>

        <h2>1. Renseignements que nous recueillons</h2>
        <ul>
          <li>Renseignements de compte : adresse courriel et identifiants de connexion.</li>
          <li>Données d'exploitation : projets, soumissions, feuilles de temps, bons de travail, photos de chantier et affectations.</li>
          <li>Données comptables provenant de QuickBooks (produits, services, clients, factures) lorsque vous autorisez la connexion.</li>
        </ul>

        <h2>2. Utilisation des renseignements</h2>
        <p>
          Les renseignements servent uniquement à fournir et améliorer les
          fonctionnalités de l'Application : planification, suivi des heures et des
          ventes, gestion du catalogue et synchronisation comptable. Nous ne
          vendons ni ne louons vos renseignements à des tiers.
        </p>

        <h2>3. Intégration QuickBooks</h2>
        <p>
          Avec votre consentement explicite, l'Application accède à votre compte
          Intuit QuickBooks via une connexion sécurisée (OAuth 2.0) afin
          d'importer vos produits, services et données comptables. Les jetons
          d'accès sont conservés de façon chiffrée et peuvent être révoqués à tout
          moment depuis votre compte Intuit ou en nous contactant.
        </p>

        <h2>4. Hébergement et sécurité</h2>
        <p>
          Les données sont hébergées sur une infrastructure sécurisée (Supabase) et
          protégées par des contrôles d'accès. L'accès est restreint aux
          utilisateurs autorisés de Plomberie Instant.
        </p>

        <h2>5. Conservation</h2>
        <p>
          Les renseignements sont conservés tant que votre compte est actif ou
          aussi longtemps que nécessaire pour fournir le service et respecter nos
          obligations légales.
        </p>

        <h2>6. Vos droits</h2>
        <p>
          Vous pouvez demander l'accès, la correction ou la suppression de vos
          renseignements en nous écrivant à l'adresse ci-dessous.
        </p>

        <h2>7. Nous joindre</h2>
        <p>
          Plomberie Instant inc.<br />
          Granby, Québec<br />
          Courriel : <a href="mailto:info@plomberieinstant.net">info@plomberieinstant.net</a>
        </p>

        <p className="legal-foot">
          <a href="/conditions">Conditions d'utilisation</a> ·{" "}
          <a href="/login">Retour à la connexion</a>
        </p>
      </div>
    </div>
  );
}
