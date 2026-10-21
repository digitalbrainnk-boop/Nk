// Écran de connexion : identifiant (e-mail OU téléphone) + mot de passe.
import 'package:flutter/material.dart';

import '../../core/constantes.dart';
import '../../modeles/utilisateur.dart';
import '../../services/service_auth.dart';
import '../../services/service_firestore.dart';
import '../../widgets/champ_saisie.dart';
import '../legal/ecran_politique.dart';
import 'ecran_inscription.dart';

class EcranConnexion extends StatefulWidget {
  const EcranConnexion({super.key});

  @override
  State<EcranConnexion> createState() => _EcranConnexionState();
}

class _EcranConnexionState extends State<EcranConnexion> {
  final _cleForm = GlobalKey<FormState>();
  final _identifiant = TextEditingController();
  final _motDePasse = TextEditingController();
  final _auth = ServiceAuth();
  final _firestore = ServiceFirestore();

  // Type d'identifiant sélectionné (e-mail par défaut).
  TypeIdentifiant _type = TypeIdentifiant.email;
  bool _occupe = false;
  String? _erreur;

  @override
  void dispose() {
    _identifiant.dispose();
    _motDePasse.dispose();
    super.dispose();
  }

  Future<void> _connecter() async {
    if (!_cleForm.currentState!.validate()) return;
    setState(() { _occupe = true; _erreur = null; });
    final r = await _auth.connecter(
      identifiant: _identifiant.text,
      type: _type,
      motDePasse: _motDePasse.text,
    );
    if (!mounted) return;
    setState(() { _occupe = false; _erreur = r.succes ? null : r.messageErreur; });
    // En cas de succès, EcranDemarrage réagit automatiquement au flux Auth.
  }

  Future<void> _connecterGoogle() async {
    setState(() { _occupe = true; _erreur = null; });
    final r = await _auth.connecterAvecGoogle();
    // À la première connexion Google, aucun profil n'a encore été créé :
    // on en crée un minimal à partir des infos du compte Google.
    if (r.succes && r.utilisateur != null) {
      final u = r.utilisateur!;
      await _firestore.assurerProfil(
        uid: u.uid,
        nomParDefaut: u.displayName ?? u.email ?? 'Utilisateur',
      );
    }
    if (!mounted) return;
    setState(() { _occupe = false; _erreur = r.succes ? null : r.messageErreur; });
  }

  Future<void> _motDePasseOublie() async {
    // La réinitialisation par e-mail n'a de sens que pour un identifiant e-mail.
    if (_type == TypeIdentifiant.telephone) {
      setState(() => _erreur =
          'Réinitialisation indisponible pour un identifiant téléphone. '
          'Utilisez un identifiant e-mail.');
      return;
    }
    if (_identifiant.text.trim().isEmpty) {
      setState(() => _erreur = 'Entrez d\'abord votre adresse e-mail.');
      return;
    }
    setState(() { _occupe = true; _erreur = null; });
    final r = await _auth.reinitialiserMotDePasse(
        identifiant: _identifiant.text, type: _type);
    if (!mounted) return;
    setState(() {
      _occupe = false;
      _erreur = r.succes ? null : r.messageErreur;
    });
    if (r.succes) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'E-mail de réinitialisation envoyé (pensez à vérifier vos spams).'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion — $kNomApp')),
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
                  const Icon(Icons.my_location, size: 64),
                  const SizedBox(height: 16),

                  // Choix du type d'identifiant.
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
                    libelle: 'Mot de passe',
                    motDePasse: true,
                    validateur: (v) =>
                        (v == null || v.isEmpty) ? 'Champ obligatoire' : null,
                  ),

                  if (_erreur != null) ...[
                    const SizedBox(height: 8),
                    Text(_erreur!, style: const TextStyle(color: Colors.red)),
                  ],

                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _occupe ? null : _connecter,
                    child: _occupe
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Se connecter'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _occupe ? null : _connecterGoogle,
                    icon: const Icon(Icons.g_mobiledata),
                    label: const Text('Continuer avec Google'),
                  ),
                  TextButton(
                    onPressed: _occupe ? null : _motDePasseOublie,
                    child: const Text('Mot de passe oublié ?'),
                  ),
                  TextButton(
                    onPressed: _occupe
                        ? null
                        : () => Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) => const EcranInscription()),
                            ),
                    child: const Text('Créer un compte'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const EcranPolitique()),
                    ),
                    child: const Text('Politique de confidentialité'),
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
