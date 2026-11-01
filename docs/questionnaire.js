/*
 * Contenu du questionnaire.
 *
 * Pour modifier une question, un choix de réponse ou un texte, il suffit de
 * changer le texte entre guillemets ci-dessous. Ne changez pas les numéros (n)
 * une fois que des participants ont commencé à répondre : les liens de réponses
 * déjà envoyés s'appuient sur eux.
 *
 * Réglages d'une question :
 *   multiple: true   -> le participant peut cocher plusieurs réponses
 *   multiple: false  -> une seule réponse
 *   (si rien n'est indiqué, c'est le réglage de la partie qui s'applique)
 *
 * Choix particuliers :
 *   { texte: "Autre", autre: true }      -> ajoute une case « Précisez »
 *   les choix « Je ne sais pas », « Sans opinion » et « Je ne comprends pas… »
 *   s'excluent automatiquement des autres réponses.
 */
window.ENQUETE = {
  // ---------------------------------------------------------------------------
  // RÉGLAGES DU CHERCHEUR
  // ---------------------------------------------------------------------------
  reglages: {
    // Numéro WhatsApp qui reçoit les réponses, au format international,
    // sans « + », sans espaces. Exemple pour le Burkina Faso : "22670123456".
    // Laissez vide ("") : le participant choisit lui-même le contact.
    whatsapp: "22676634189",

    // Adresse e-mail qui reçoit les réponses (facultatif).
    email: "",

    // Adresse publique du questionnaire. Elle sert à fabriquer les liens de
    // réponses quand la page est ouverte depuis un fichier sur le téléphone.
    lienDuSite: "https://digitalbrainnk-boop.github.io/Nk/",

    // Adresse de l'application publiée sur claude.ai (lien à envoyer aux participants).
    lienArtefact: "https://claude.ai/artifact/2TRJFjgvArJcnyXXMiTjYQ",

    // Objectif d'échantillonnage affiché dans l'espace chercheur.
    objectifParConfession: 50,

    // « Mes documents » : dépôt GitHub où sont rangés les documents mis en lien.
    // Le site est publié depuis la branche « gh-pages », à la racine (dossier vide).
    depot: {
      proprietaire: "digitalbrainnk-boop",
      nom: "Nk",
      branche: "gh-pages",
      dossier: "",
    },
  },

  // Version du questionnaire (inscrite dans chaque réponse).
  version: 1,

  titre: "La grâce divine et la liberté humaine",
  surtitre: "Questionnaire d'enquête de terrain",
  cadre: "Ville de Ouagadougou, Burkina Faso",
  chercheur: "SAWADOGO Bouraïma",
  institution: "École Missionnaire Génération Joël (EMGJ)",
  directeur: "Dr Jéhu Blaise Koffi Amoussou",
  echantillon:
    "100 personnes dont 50 participants de la communauté catholique et 50 participants de la communauté protestante.",

  introduction: [
    "Madame, Monsieur,",
    "Dans le cadre de la réalisation de ma thèse de doctorat en théologie portant sur le thème « La grâce divine et la liberté humaine », je mène une enquête auprès des fidèles des communautés chrétiennes de la ville de Ouagadougou.",
    "Cette recherche vise à comprendre comment les chrétiens perçoivent la grâce de Dieu, la liberté humaine, le libre arbitre et la responsabilité de l'homme dans son cheminement spirituel.",
    "Votre participation est importante pour la réussite de cette étude.",
    "Les informations recueillies seront utilisées exclusivement à des fins scientifiques et académiques. Le questionnaire est anonyme et votre participation est entièrement volontaire.",
    "Il n'existe pas de bonnes ou de mauvaises réponses. Nous souhaitons simplement recueillir votre opinion personnelle et votre compréhension de ces questions.",
    "Nous vous remercions sincèrement pour votre disponibilité et votre contribution.",
  ],
  signatureIntroduction: "Le chercheur",

  remerciements: [
    "Nous vous remercions sincèrement pour votre participation à cette enquête.",
    "Votre contribution permettra d'enrichir la réflexion théologique sur la grâce divine et la liberté humaine et d'examiner les implications de cette relation dans la vie des communautés chrétiennes.",
  ],
  signature: [
    "SAWADOGO Bouraïma",
    "Doctorant en théologie",
    "École Missionnaire Génération Joël (EMGJ)",
  ],

  // ---------------------------------------------------------------------------
  // LES SEPT PARTIES
  // ---------------------------------------------------------------------------
  parties: [
    {
      titre: "Identification du participant",
      rang: "Première partie",
      description: "Cette partie permettra de caractériser les personnes interrogées.",
      multiple: false,
      questions: [
        { n: 1, texte: "Sexe :", options: ["Masculin", "Féminin"] },
        {
          n: 2,
          texte: "Dans quelle tranche d'âge vous situez-vous ?",
          options: ["Moins de 20 ans", "20 à 30 ans", "31 à 40 ans", "41 à 50 ans", "51 à 60 ans", "Plus de 60 ans"],
        },
        { n: 3, texte: "Quelle est votre confession chrétienne ?", options: ["Catholique", "Protestant"] },
        {
          n: 4,
          texte: "Depuis combien de temps êtes-vous chrétien(ne) pratiquant(e) ?",
          options: ["Moins de 5 ans", "5 à 10 ans", "11 à 20 ans", "Plus de 20 ans"],
        },
        {
          n: 5,
          texte: "Quel est votre niveau d'instruction ?",
          options: ["Aucun", "Primaire", "Secondaire", "Supérieur"],
        },
        {
          n: 6,
          texte: "Participez-vous régulièrement aux activités de votre communauté chrétienne ?",
          options: ["Très régulièrement", "Régulièrement", "Occasionnellement", "Rarement"],
        },
      ],
    },
    {
      titre: "Compréhension de la grâce divine",
      rang: "Deuxième partie",
      description: "Cette partie cherche à comprendre comment les fidèles définissent et perçoivent la grâce de Dieu.",
      multiple: true,
      questions: [
        {
          n: 7,
          texte: "Selon vous, qu'est-ce que la grâce divine ?",
          options: [
            "Un don gratuit de Dieu accordé à l'homme.",
            "Une faveur imméritée accordée par Dieu.",
            "Une force divine qui aide l'homme à vivre selon la volonté de Dieu.",
            "Une récompense accordée aux personnes qui pratiquent le bien.",
            { texte: "Autre", autre: true },
          ],
        },
        {
          n: 8,
          texte: "Pensez-vous que l'homme peut obtenir le salut par ses propres efforts, sans la grâce de Dieu ?",
          options: ["Oui", "Non", "Je ne sais pas"],
        },
        {
          n: 9,
          texte: "Selon vous, la grâce de Dieu est-elle indispensable au salut de l'homme ?",
          options: ["Tout à fait d'accord", "D'accord", "Pas d'accord", "Pas du tout d'accord", "Sans opinion"],
        },
        {
          n: 10,
          texte: "La grâce divine est-elle accordée uniquement à certaines personnes ou est-elle proposée à tous les hommes ?",
          options: [
            "Elle est destinée à certaines personnes seulement.",
            "Elle est proposée à tous les hommes.",
            "Elle est proposée à tous, mais chacun peut y répondre différemment.",
            "Je ne sais pas.",
          ],
        },
        {
          n: 11,
          texte: "Pensez-vous que Dieu continue d'agir dans la vie d'une personne même lorsque celle-ci commet des péchés ?",
          options: ["Oui", "Non", "Je ne sais pas"],
        },
      ],
    },
    {
      titre: "Liberté humaine et libre arbitre",
      rang: "Troisième partie",
      description:
        "Cette partie porte sur la capacité de l'homme à faire des choix et à assumer ses décisions devant Dieu.",
      multiple: true,
      questions: [
        {
          n: 12,
          texte: "Selon vous, l'être humain possède-t-il une véritable liberté de choisir entre le bien et le mal ?",
          options: ["Oui", "Non", "Partiellement", "Je ne sais pas"],
        },
        {
          n: 13,
          texte: "Après la chute d'Adam et Ève, l'homme a-t-il conservé sa liberté de décision ?",
          options: [
            "Oui, entièrement.",
            "Oui, mais sa liberté est affectée par le péché.",
            "Non, il a totalement perdu sa liberté spirituelle.",
            "Je ne sais pas.",
          ],
        },
        {
          n: 14,
          texte: "Pensez-vous qu'un homme peut refuser volontairement l'appel de Dieu ?",
          options: ["Oui", "Non", "Cela dépend des circonstances.", "Je ne sais pas."],
        },
        {
          n: 15,
          texte: "Lorsqu'une personne décide de suivre Jésus-Christ, cette décision résulte-t-elle :",
          options: [
            "Uniquement de la volonté de Dieu.",
            "Uniquement de la volonté humaine.",
            "De l'action de Dieu et de la réponse humaine.",
            "Je ne sais pas.",
          ],
        },
        {
          n: 16,
          texte: "Selon vous, l'homme est-il responsable de ses choix devant Dieu ?",
          options: [
            "Oui, totalement.",
            "Oui, mais avec l'aide de la grâce divine.",
            "Non, car tout dépend de la volonté de Dieu.",
            "Je ne sais pas.",
          ],
        },
      ],
    },
    {
      titre: "Relation entre la grâce divine et la liberté humaine",
      rang: "Quatrième partie",
      description: "Cette partie constitue le cœur de notre enquête.",
      multiple: true,
      questions: [
        {
          n: 17,
          texte: "Pensez-vous que la grâce divine et la liberté humaine peuvent fonctionner ensemble sans se contredire ?",
          options: ["Oui", "Non", "Je ne sais pas"],
        },
        {
          n: 18,
          texte: "Lorsqu'une personne reçoit la grâce de Dieu, conserve-t-elle la possibilité de lui désobéir ?",
          options: ["Oui", "Non", "Cela dépend de la situation spirituelle de la personne.", "Je ne sais pas."],
        },
        {
          n: 19,
          texte: "Selon vous, Dieu peut-il sauver une personne qui refuse librement de croire en lui ?",
          options: ["Oui", "Non", "Je ne sais pas."],
        },
        {
          n: 20,
          texte:
            "Comment comprenez-vous le passage de Philippiens 2:12-13, qui demande aux croyants d'opérer leur salut tout en affirmant que Dieu produit en eux le vouloir et le faire ?",
          options: [
            "Dieu accomplit tout et l'homme n'a aucune responsabilité.",
            "L'homme accomplit son salut par ses propres efforts.",
            "Dieu agit dans l'homme et celui-ci est appelé à répondre activement.",
            "Je ne comprends pas suffisamment ce passage.",
          ],
        },
        {
          n: 21,
          texte: "Selon vous, la grâce de Dieu rend-elle l'homme plus libre et plus responsable ?",
          options: ["Oui", "Non", "Partiellement", "Je ne sais pas."],
        },
        {
          n: 22,
          texte:
            "Un chrétien peut-il perdre la grâce de Dieu par ses mauvais choix et son refus persistant de lui obéir ?",
          options: ["Oui", "Non", "Cela dépend de la compréhension théologique de la grâce.", "Je ne sais pas."],
        },
      ],
    },
    {
      titre: "Grâce, sanctification et responsabilité chrétienne",
      rang: "Cinquième partie",
      description: "",
      multiple: true,
      questions: [
        {
          n: 23,
          texte: "La sanctification du chrétien dépend-elle uniquement de Dieu ?",
          options: ["Oui", "Non", "Elle dépend de Dieu et de l'engagement du croyant."],
        },
        {
          n: 24,
          texte: "Quelle place accordez-vous à la prière dans votre croissance spirituelle ?",
          options: [
            "Une place indispensable.",
            "Une place importante.",
            "Une place secondaire.",
            "Aucune place particulière.",
          ],
        },
        {
          n: 25,
          texte:
            "Selon vous, un chrétien qui ne prie pas, ne lit pas la Bible et ne pratique pas les enseignements du Christ peut-il espérer grandir spirituellement ?",
          options: ["Oui", "Non", "Cela dépend de la grâce de Dieu."],
        },
        {
          n: 26,
          texte:
            "La grâce divine dispense-t-elle le chrétien de ses responsabilités familiales, professionnelles et sociales ?",
          options: ["Oui", "Non", "Je ne sais pas."],
        },
        {
          n: 27,
          texte: "Le chrétien doit-il fournir des efforts personnels pour progresser dans sa vie spirituelle ?",
          options: ["Oui", "Non", "Oui, mais toujours avec l'assistance de Dieu."],
        },
      ],
    },
    {
      titre: "Grâce, destinée et fatalisme dans le contexte africain",
      rang: "Sixième partie",
      description:
        "Cette partie permettra d'examiner les implications pastorales de la recherche dans le contexte burkinabè.",
      multiple: true,
      questions: [
        {
          n: 28,
          texte: "Pensez-vous que tout ce qui arrive à l'homme est nécessairement voulu et décidé par Dieu ?",
          options: ["Oui", "Non", "Certaines choses seulement.", "Je ne sais pas."],
        },
        {
          n: 29,
          texte:
            "Lorsqu'une personne connaît des échecs répétés dans sa vie, peut-on considérer que cela relève uniquement de la volonté de Dieu ?",
          options: ["Oui", "Non", "Pas nécessairement.", "Je ne sais pas."],
        },
        {
          n: 30,
          texte:
            "Pensez-vous que certaines personnes utilisent l'expression « C'est la volonté de Dieu » pour éviter leurs responsabilités ?",
          options: ["Oui", "Non", "Parfois", "Je ne sais pas."],
        },
        {
          n: 31,
          texte:
            "Selon vous, la foi chrétienne doit-elle encourager les fidèles à prendre des initiatives pour améliorer leurs conditions de vie ?",
          options: ["Oui", "Non", "Je ne sais pas."],
        },
        {
          n: 32,
          texte:
            "Pensez-vous que la prédication chrétienne actuelle accorde suffisamment de place à la responsabilité personnelle des fidèles ?",
          options: ["Oui", "Non", "Partiellement", "Je ne sais pas."],
        },
      ],
    },
    {
      titre: "Questions ouvertes",
      rang: "Septième partie",
      description:
        "Ces questions permettront de recueillir des opinions personnelles et des réflexions plus approfondies.",
      questions: [
        {
          n: 33,
          ouverte: true,
          texte: "Avec vos propres mots, comment expliquez-vous la relation entre la grâce de Dieu et la liberté humaine ?",
        },
        {
          n: 34,
          ouverte: true,
          texte:
            "Selon vous, pourquoi certaines personnes qui connaissent la Parole de Dieu continuent-elles à vivre dans le péché ?",
        },
        {
          n: 35,
          ouverte: true,
          texte:
            "Comment peut-on aider les chrétiens à comprendre qu'ils dépendent de la grâce de Dieu tout en étant responsables de leurs actes ?",
        },
        {
          n: 36,
          ouverte: true,
          texte:
            "Que pensez-vous de cette affirmation : « La grâce de Dieu ne supprime pas la responsabilité humaine, mais elle rend l'homme capable de répondre à Dieu et d'assumer ses responsabilités » ?",
        },
        {
          n: 37,
          ouverte: true,
          texte:
            "Quelles recommandations pourriez-vous faire aux responsables religieux pour mieux enseigner la relation entre la grâce divine et la liberté humaine dans les Églises du Burkina Faso ?",
        },
      ],
    },
  ],
};
