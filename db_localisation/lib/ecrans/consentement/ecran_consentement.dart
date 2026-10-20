// Écran de consentement + CGU, affiché au premier passage en mode AGENT.
// L'utilisateur doit cocher la case et accepter explicitement.
import 'package:flutter/material.dart';

import '../../services/service_consentement.dart';
import 'texte_cgu.dart';

class EcranConsentement extends StatefulWidget {
  const EcranConsentement({super.key});

  @override
  State<EcranConsentement> createState() => _EcranConsentementState();
}

class _EcranConsentementState extends State<EcranConsentement> {
  final _consentement = ServiceConsentement();
  bool _coche = false;

  Future<void> _accepter() async {
    await _consentement.enregistrerConsentement(true);
    if (!mounted) return;
    Navigator.of(context).pop(true); // true = accepté.
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Consentement — appareil protégé')),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Text(kTexteConsentement,
                  style: const TextStyle(height: 1.4)),
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                CheckboxListTile(
                  value: _coche,
                  onChanged: (v) => setState(() => _coche = v ?? false),
                  title: const Text(
                      'Je protège MON propre appareil et j\'accepte les conditions.'),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        child: const Text('Refuser'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: _coche ? _accepter : null,
                        child: const Text('Accepter et activer'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
