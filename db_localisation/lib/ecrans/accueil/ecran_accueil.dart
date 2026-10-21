// Écran d'accueil (après connexion) :
//  - liste des appareils du compte (temps réel) ;
//  - enregistrement de CET appareil (nom + UUID d'installation) ;
//  - accès au rôle CONSOLE (toutes plateformes) ou AGENT (consentement requis).
import 'package:flutter/material.dart';

import '../../core/constantes.dart';
import '../../modeles/appareil.dart';
import '../../services/service_auth.dart';
import '../../services/service_consentement.dart';
import '../../services/service_firestore.dart';
import '../../services/service_installation.dart';
import '../agent/ecran_agent.dart';
import '../console/ecran_console.dart';
import '../consentement/ecran_consentement.dart';
import '../protection/ecran_protection.dart';

class EcranAccueil extends StatefulWidget {
  final String uid;
  const EcranAccueil({super.key, required this.uid});

  @override
  State<EcranAccueil> createState() => _EcranAccueilState();
}

class _EcranAccueilState extends State<EcranAccueil> {
  final _firestore = ServiceFirestore();
  final _auth = ServiceAuth();
  final _consentement = ServiceConsentement();

  /// Enregistre CET appareil sous le compte (dialogue pour le nom).
  Future<void> _enregistrerCetAppareil() async {
    final nomDefaut = await ServiceInstallation.nomParDefaut();
    if (!mounted) return;
    final controleur = TextEditingController(text: nomDefaut);

    final nom = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Enregistrer cet appareil'),
        content: TextField(
          controller: controleur,
          decoration: const InputDecoration(labelText: 'Nom de l\'appareil'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controleur.text.trim()),
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
    if (nom == null || nom.isEmpty) return;

    final uuid = await ServiceInstallation.obtenirOuCreerUuid();
    final version = await ServiceInstallation.versionApp();
    final deviceId = await _firestore.enregistrerAppareil(
      uid: widget.uid,
      appareil: Appareil(
        deviceId: '',
        nom: nom,
        installUuid: uuid,
        plateforme: ServiceInstallation.plateformeCourante(),
        versionApp: version,
      ),
    );
    await _consentement.definirDeviceId(deviceId);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Appareil « $nom » enregistré.')),
    );
  }

  /// Active le rôle AGENT sur cet appareil : exige le consentement.
  Future<void> _activerAgent() async {
    final dejaConsenti = await _consentement.consentementAccepte();
    if (!dejaConsenti) {
      if (!mounted) return;
      final accepte = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => const EcranConsentement()),
      );
      if (accepte != true) return; // Refus : on n'active rien.
    }
    await _consentement.definirRole(RolesAppareil.agent);
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => EcranAgent(uid: widget.uid)),
    );
  }

  void _ouvrirConsole() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => EcranConsole(uid: widget.uid)),
    );
  }

  void _ouvrirProtection() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => EcranProtection(uid: widget.uid)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(kNomApp),
        actions: [
          IconButton(
            tooltip: 'Se déconnecter',
            onPressed: () => _auth.deconnecter(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Column(
        children: [
          // Deux grands boutons de rôle.
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: _CarteRole(
                    icone: Icons.map,
                    titre: 'Console',
                    sousTitre: 'Retrouver mes appareils',
                    onTap: _ouvrirConsole,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _CarteRole(
                    icone: Icons.shield,
                    titre: 'Agent',
                    sousTitre: 'Protéger cet appareil',
                    onTap: _activerAgent,
                  ),
                ),
              ],
            ),
          ),

          // Accès à l'écran de renforcement (protections natives anti-reset,
          // infos de récupération, check-list en cas de vol).
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: OutlinedButton.icon(
              onPressed: _ouvrirProtection,
              icon: const Icon(Icons.verified_user),
              label: const Text('Renforcer la protection (anti-reset, vol)'),
              style:
                  OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
            ),
          ),

          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Mes appareils',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),

          // Liste temps réel des appareils du compte.
          Expanded(
            child: StreamBuilder<List<Appareil>>(
              stream: _firestore.fluxAppareils(widget.uid),
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                final appareils = snap.data ?? [];
                if (appareils.isEmpty) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('Aucun appareil enregistré pour le moment.'),
                    ),
                  );
                }
                return ListView.separated(
                  itemCount: appareils.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final a = appareils[i];
                    return ListTile(
                      leading: Icon(_iconePlateforme(a.plateforme)),
                      title: Text(a.nom),
                      subtitle: Text('${a.plateforme} • v${a.versionApp}'),
                      trailing: PopupMenuButton<String>(
                        onSelected: (v) => _actionAppareil(v, a),
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'renommer', child: Text('Renommer')),
                          PopupMenuItem(value: 'retirer', child: Text('Retirer')),
                        ],
                      ),
                      onTap: _ouvrirConsole,
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _enregistrerCetAppareil,
        icon: const Icon(Icons.add),
        label: const Text('Enregistrer cet appareil'),
      ),
    );
  }

  Future<void> _actionAppareil(String action, Appareil a) async {
    if (action == 'renommer') {
      final c = TextEditingController(text: a.nom);
      final nouveau = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Renommer'),
          content: TextField(controller: c),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, c.text.trim()),
                child: const Text('OK')),
          ],
        ),
      );
      if (nouveau != null && nouveau.isNotEmpty) {
        await _firestore.renommerAppareil(
            uid: widget.uid, deviceId: a.deviceId, nouveauNom: nouveau);
      }
    } else if (action == 'retirer') {
      await _firestore.retirerAppareil(uid: widget.uid, deviceId: a.deviceId);
    }
  }

  IconData _iconePlateforme(String p) {
    switch (p) {
      case 'android':
        return Icons.android;
      case 'ios':
        return Icons.phone_iphone;
      case 'web':
        return Icons.language;
      default:
        return Icons.computer;
    }
  }
}

/// Carte cliquable pour choisir un rôle.
class _CarteRole extends StatelessWidget {
  final IconData icone;
  final String titre;
  final String sousTitre;
  final VoidCallback onTap;
  const _CarteRole({
    required this.icone,
    required this.titre,
    required this.sousTitre,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 12),
          child: Column(
            children: [
              Icon(icone, size: 40),
              const SizedBox(height: 8),
              Text(titre, style: const TextStyle(fontWeight: FontWeight.bold)),
              Text(sousTitre, textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}
