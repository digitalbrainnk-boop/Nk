// Écran affichant la politique de confidentialité intégrée.
import 'package:flutter/material.dart';

import 'textes_legaux.dart';

class EcranPolitique extends StatelessWidget {
  const EcranPolitique({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Politique de confidentialité')),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(20),
        child: Text(kPolitiqueConfidentialite, style: TextStyle(height: 1.4)),
      ),
    );
  }
}
