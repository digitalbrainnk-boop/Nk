// Écran « Renforcer la protection ».
//
// Trois sections :
//  A. Activer les protections NATIVES (selon la plateforme) — seules à
//     survivre à une réinitialisation d'usine / un flash.
//  B. Enregistrer les INFOS DE RÉCUPÉRATION par appareil (IMEI, série,
//     contact) — saisies par l'utilisateur, stockées dans Firestore.
//  C. Check-list « EN CAS DE VOL », cochable, mémorisée localement.
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../modeles/appareil.dart';
import '../../modeles/infos_recuperation.dart';
import '../../services/service_firestore.dart';
import '../../services/service_installation.dart';
import 'contenu_protection.dart';

class EcranProtection extends StatefulWidget {
  final String uid;
  const EcranProtection({super.key, required this.uid});

  @override
  State<EcranProtection> createState() => _EcranProtectionState();
}

class _EcranProtectionState extends State<EcranProtection> {
  final _firestore = ServiceFirestore();
  final _plateforme = ServiceInstallation.plateformeCourante();

  // Section B — appareil sélectionné + champs de saisie.
  String? _deviceIdSelectionne;
  final _imei = TextEditingController();
  final _serie = TextEditingController();
  final _contact = TextEditingController();
  final _note = TextEditingController();
  bool _enregistrement = false;

  // Section C — état coché des étapes (clé -> bool), mémorisé localement.
  final Map<String, bool> _etapesCochees = {};

  // Section « Récupération du compte » — jusqu'à 3 adresses de confiance.
  final _emails = [
    TextEditingController(),
    TextEditingController(),
    TextEditingController(),
  ];
  bool _enregistrementEmails = false;

  @override
  void initState() {
    super.initState();
    _chargerEtapes();
    _chargerEmails();
  }

  @override
  void dispose() {
    _imei.dispose();
    _serie.dispose();
    _contact.dispose();
    _note.dispose();
    for (final c in _emails) {
      c.dispose();
    }
    super.dispose();
  }

  // --- Récupération du compte : chargement / enregistrement ---
  Future<void> _chargerEmails() async {
    final liste = await _firestore.lireEmailsRecuperation(widget.uid);
    if (!mounted) return;
    setState(() {
      for (var i = 0; i < _emails.length; i++) {
        _emails[i].text = i < liste.length ? liste[i] : '';
      }
    });
  }

  bool _emailValide(String e) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e);

  Future<void> _enregistrerEmails() async {
    // On ne garde que les champs remplis ; chacun doit être un e-mail valide.
    final saisies = _emails.map((c) => c.text.trim()).toList();
    final nonVides = saisies.where((e) => e.isNotEmpty).toList();
    final invalides = nonVides.where((e) => !_emailValide(e)).toList();
    if (invalides.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Adresse invalide : ${invalides.first}')),
      );
      return;
    }
    setState(() => _enregistrementEmails = true);
    await _firestore.majEmailsRecuperation(widget.uid, nonVides);
    if (!mounted) return;
    setState(() => _enregistrementEmails = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Adresses de récupération enregistrées.')),
    );
  }

  // --- Section C : persistance locale de la check-list ---
  Future<void> _chargerEtapes() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      for (final e in kEtapesVol) {
        _etapesCochees[e.cle] = prefs.getBool('protection_${e.cle}') ?? false;
      }
    });
  }

  Future<void> _basculerEtape(String cle, bool valeur) async {
    setState(() => _etapesCochees[cle] = valeur);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('protection_$cle', valeur);
  }

  // --- Ouverture d'un lien externe, avec message si échec ---
  Future<void> _ouvrirLien(String url) async {
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Impossible d\'ouvrir : $url')),
      );
    }
  }

  // --- Section B : charger les infos de l'appareil choisi ---
  Future<void> _chargerInfos(String deviceId) async {
    final infos = await _firestore.lireInfosRecuperation(
        uid: widget.uid, deviceId: deviceId);
    if (!mounted) return;
    setState(() {
      _deviceIdSelectionne = deviceId;
      _imei.text = infos.imei;
      _serie.text = infos.numeroSerie;
      _contact.text = infos.contactUrgence;
      _note.text = infos.note;
    });
  }

  Future<void> _enregistrerInfos() async {
    final deviceId = _deviceIdSelectionne;
    if (deviceId == null) return;
    setState(() => _enregistrement = true);
    await _firestore.majInfosRecuperation(
      uid: widget.uid,
      deviceId: deviceId,
      infos: InfosRecuperation(
        imei: _imei.text.trim(),
        numeroSerie: _serie.text.trim(),
        contactUrgence: _contact.text.trim(),
        note: _note.text.trim(),
      ),
    );
    if (!mounted) return;
    setState(() => _enregistrement = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Infos de récupération enregistrées.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Renforcer la protection')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Rappel honnête en tête.
          Card(
            color: Colors.amber.shade50,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.info_outline),
                  SizedBox(width: 12),
                  Expanded(child: Text(kRappelHonnete)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          _titreSection('Récupération du compte (optionnel)'),
          _sectionEmailsRecuperation(),

          const SizedBox(height: 24),
          _titreSection('1. Activer les protections intégrées'),
          ..._sectionProtectionsNatives(),

          const SizedBox(height: 24),
          _titreSection('2. Infos de récupération (en cas de vol)'),
          _sectionInfosRecuperation(),

          const SizedBox(height: 24),
          _titreSection('3. Que faire en cas de vol'),
          _sectionCheckListVol(),
        ],
      ),
    );
  }

  Widget _titreSection(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t,
            style:
                const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
      );

  // --- Section « Récupération du compte » ---
  Widget _sectionEmailsRecuperation() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Adresses de confiance qui pourront aider à récupérer votre accès '
              'en cas de perte (la vôtre, celle d\'un parent, d\'un ami). '
              'Facultatif : laissez vide, ou remplissez 1 à 3 adresses.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < _emails.length; i++)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: TextField(
                  controller: _emails[i],
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    labelText: 'Adresse ${i + 1}',
                    hintText: i == 0 ? 'votre e-mail' : 'e-mail de confiance',
                  ),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _enregistrementEmails ? null : _enregistrerEmails,
              icon: _enregistrementEmails
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save),
              label: const Text('Enregistrer les adresses'),
            ),
            const SizedBox(height: 8),
            const Text(
              'Note : aujourd\'hui, la réinitialisation Firebase est envoyée à '
              'l\'adresse du compte. L\'envoi automatique vers ces adresses de '
              'confiance sera activé avec le serveur (Cloud Functions, étape 4).',
              style: TextStyle(fontSize: 11, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  // --- Section A ---
  List<Widget> _sectionProtectionsNatives() {
    List<ActionProtection> actions;
    Widget? note;
    if (_plateforme == 'android') {
      actions = kActionsAndroid;
    } else if (_plateforme == 'ios') {
      actions = kActionsIos;
    } else {
      // Console (web/desktop) : on explique + on montre les deux plateformes.
      actions = [...kActionsIos, ...kActionsAndroid];
      note = Card(
        color: Colors.blue.shade50,
        child: const Padding(
          padding: EdgeInsets.all(16),
          child: Text(kNoteConsole),
        ),
      );
    }
    return [
      if (note != null) ...[note, const SizedBox(height: 8)],
      for (final a in actions) _carteAction(a),
    ];
  }

  Widget _carteAction(ActionProtection a) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(a.titre, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text(a.description),
            if (a.lien != null) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: () => _ouvrirLien(a.lien!),
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: Text(a.libelleBouton ?? 'Ouvrir'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // --- Section B ---
  Widget _sectionInfosRecuperation() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Choix de l'appareil concerné (flux temps réel).
            StreamBuilder<List<Appareil>>(
              stream: _firestore.fluxAppareils(widget.uid),
              builder: (context, snap) {
                final appareils = snap.data ?? [];
                if (appareils.isEmpty) {
                  return const Text(
                      'Enregistrez d\'abord un appareil pour y associer ses '
                      'infos de récupération.');
                }
                return DropdownButtonFormField<String>(
                  initialValue: _deviceIdSelectionne,
                  decoration: const InputDecoration(labelText: 'Appareil'),
                  items: [
                    for (final a in appareils)
                      DropdownMenuItem(value: a.deviceId, child: Text(a.nom)),
                  ],
                  onChanged: (id) {
                    if (id != null) _chargerInfos(id);
                  },
                );
              },
            ),
            const SizedBox(height: 8),
            const Text(
              'Astuce : composez *#06# sur le téléphone pour afficher son IMEI. '
              'Depuis Android 10, l\'app ne peut pas le lire automatiquement.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
            const SizedBox(height: 8),
            _champ(_imei, 'IMEI (*#06#)', TextInputType.number),
            _champ(_serie, 'Numéro de série', TextInputType.text),
            _champ(_contact, 'Contact à afficher si trouvé', TextInputType.text),
            _champ(_note, 'Note (preuve d\'achat, description...)',
                TextInputType.multiline),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: (_deviceIdSelectionne == null || _enregistrement)
                  ? null
                  : _enregistrerInfos,
              icon: _enregistrement
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save),
              label: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _champ(
      TextEditingController c, String libelle, TextInputType type) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: TextField(
        controller: c,
        keyboardType: type,
        maxLines: type == TextInputType.multiline ? 3 : 1,
        decoration: InputDecoration(labelText: libelle),
      ),
    );
  }

  // --- Section C ---
  Widget _sectionCheckListVol() {
    return Card(
      child: Column(
        children: [
          for (final e in kEtapesVol)
            CheckboxListTile(
              value: _etapesCochees[e.cle] ?? false,
              onChanged: (v) => _basculerEtape(e.cle, v ?? false),
              title: Text(e.libelle),
              controlAffinity: ListTileControlAffinity.leading,
            ),
        ],
      ),
    );
  }
}
