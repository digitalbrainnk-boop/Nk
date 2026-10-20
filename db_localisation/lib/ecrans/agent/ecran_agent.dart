// Écran AGENT — squelette d'étape 1 (appareil protégé).
//
// Rappel honnête des capacités par plateforme :
//  - Android : service de premier plan + notification permanente, boot,
//    exclusion batterie, mode SMS, commandes, Device Admin (étapes 2, 4, 5).
//  - iOS : version LIMITÉE (localisation arrière-plan autorisée, mode perdu,
//    alarme via notifications). Apple interdit SMS/boot/service caché.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../services/service_installation.dart';

class EcranAgent extends StatelessWidget {
  final String uid;
  const EcranAgent({super.key, required this.uid});

  @override
  Widget build(BuildContext context) {
    final plateforme = ServiceInstallation.plateformeCourante();
    final estIos = plateforme == 'ios';

    return Scaffold(
      appBar: AppBar(title: const Text('Agent — appareil protégé')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Bandeau "visible et consenti".
          Card(
            color: Colors.blue.shade50,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.visibility),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Cet appareil est protégé. Le suivi est VISIBLE : une '
                      'notification permanente l\'indiquera quand le service '
                      'tournera (étape 2).',
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Avertissement iOS honnête (règle non-négociable : l'indiquer).
          if (estIos)
            Card(
              color: Colors.orange.shade50,
              child: const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Sur iPhone / iPad, la protection est LIMITÉE : localisation '
                  'en arrière-plan autorisée, mode perdu et alarme via '
                  'notifications. Apple interdit la lecture des SMS, le '
                  'démarrage au boot et les services cachés.',
                ),
              ),
            ),

          const SizedBox(height: 16),
          const Text('Fonctions à activer (prochaines étapes) :',
              style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),

          _ligneFonction(Icons.my_location, 'Suivi de position périodique', 'Étape 2'),
          if (!estIos) ...[
            _ligneFonction(Icons.restart_alt, 'Démarrage au boot', 'Étape 2'),
            _ligneFonction(Icons.battery_alert, 'Exclusion batterie', 'Étape 2'),
            _ligneFonction(Icons.sms, 'Mode SMS (code secret)', 'Étape 5'),
            _ligneFonction(Icons.sim_card, 'Alerte changement de SIM', 'Étape 5'),
            _ligneFonction(Icons.lock, 'Device Admin (verrouillage)', 'Étape 4'),
          ],
          _ligneFonction(Icons.volume_up, 'Alarme à distance', 'Étape 4'),

          const SizedBox(height: 24),
          if (kDebugMode)
            Text('UID du compte : $uid',
                style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _ligneFonction(IconData icone, String libelle, String etape) {
    return ListTile(
      dense: true,
      leading: Icon(icone),
      title: Text(libelle),
      trailing: Chip(label: Text(etape)),
    );
  }
}
