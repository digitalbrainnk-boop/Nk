// Écran d'inscription : nom + identifiant (e-mail OU téléphone) + mot de passe.
// À la création du compte, on crée aussi le profil Firestore.
import 'package:flutter/material.dart';

import '../../modeles/utilisateur.dart';
import '../../services/service_auth.dart';
import '../../services/service_firestore.dart';
import '../../widgets/champ_saisie.dart';

class EcranInscription extends StatefulWidget {
  const EcranInscription({super.key});

  @override
  State<EcranInscription> createState() => _EcranInscriptionState();
}

class _EcranInscriptionState extends State<EcranInscription> {
  final _cleForm = GlobalKey<FormState>();
  final _nom = TextEditingController();
  final _identifiant = TextEditingController();
  final _motDePasse = TextEditingController();
  final _auth = ServiceAuth();
  final _firestore = ServiceFirestore();

  TypeIdentifiant _type = TypeIdentifiant.email;
  bool _occupe = false;
  String? _erreur;

  @override
  void dispose() {
    _nom.dispose();
    _identifiant.dispose();
    _motDePasse.dispose();
    super.dispose();
  }

  Future<void> _inscrire() async {
    if (!_cleForm.currentState!.validate()) return;
    setState(() { _occupe = true; _erreur = null; });

    final r = await _auth.inscrire(
      identifiant: _identifiant.text,
      type: _type,
      motDePasse: _motDePasse.text,
    );

    if (!r.succes || r.utilisateur == null) {
      if (!mounted) return;
      setState(() { _occupe = false; _erreur = r.messageErreur; });
      return;
    }

    // Création du profil Firestore (nom + type d'identifiant).
    await _firestore.creerProfil(ProfilUtilisateur(
      uid: r.utilisateur!.uid,
      nom: _nom.text.trim(),
      typeIdentifiant: _type,
    ));

    if (!mounted) return;
    setState(() => _occupe = false);
    // Retour : EcranDemarrage route automatiquement vers l'accueil.
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Créer un compte')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _cleForm,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ChampSaisie(
                    controleur: _nom,
                    libelle: 'Votre nom',
                    validateur: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Champ obligatoire' : null,
                  ),
                  SegmentedButton<TypeIdentifiant>(
                    segments: const [
                      ButtonSegment(value: TypeIdentifiant.email, label: Text('E-mail')),
                      ButtonSegment(value: TypeIdentifiant.telephone, label: Text('Téléphone')),
                    ],
                    selected: {_type},
                    onSelectionChanged: (s) => setState(() => _type = s.first),
                  ),
                  ChampSaisie(
                    controleur: _identifiant,
                    libelle: _type == TypeIdentifiant.email
                        ? 'Adresse e-mail'
                        : 'Numéro de téléphone',
                    typeClavier: _type == TypeIdentifiant.email
                        ? TextInputType.emailAddress
                        : TextInputType.phone,
                    validateur: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Champ obligatoire' : null,
                  ),
                  ChampSaisie(
                    controleur: _motDePasse,
                    libelle: 'Mot de passe (6 caractères min.)',
                    motDePasse: true,
                    validateur: (v) => (v == null || v.length < 6)
                        ? '6 caractères minimum'
                        : null,
                  ),
                  if (_erreur != null) ...[
                    const SizedBox(height: 8),
                    Text(_erreur!, style: const TextStyle(color: Colors.red)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _occupe ? null : _inscrire,
                    child: _occupe
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Créer mon compte'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
