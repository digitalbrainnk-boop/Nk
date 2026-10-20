// Widget réutilisable : champ de saisie avec libellé.
import 'package:flutter/material.dart';

class ChampSaisie extends StatelessWidget {
  final TextEditingController controleur;
  final String libelle;
  final bool motDePasse;
  final TextInputType? typeClavier;
  final String? Function(String?)? validateur;

  const ChampSaisie({
    super.key,
    required this.controleur,
    required this.libelle,
    this.motDePasse = false,
    this.typeClavier,
    this.validateur,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: TextFormField(
        controller: controleur,
        obscureText: motDePasse,
        keyboardType: typeClavier,
        decoration: InputDecoration(labelText: libelle),
        validator: validateur,
      ),
    );
  }
}
