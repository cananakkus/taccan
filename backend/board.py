from card import Card
from team import Team
from player import Player


WORDS = [
  "Kedi", "Uçak", "Elma", "Deniz", "Bilgisayar",
  "Saat", "Köprü", "Güneş", "Kitap", "Telefon",
  "Masa", "Kalem", "Ay", "Bulut", "Araba",
  "Yıldız", "Dağ", "Kahve", "Müzik", "Ağaç",
  "Kapı", "Film", "Oyun", "Kamera", "Bardak"]


class Board:
    
    def __init__(self):
        self.cards = []
        self.create_board()
    
    def create_board(self, words):
        for i in range(len(words)):
            word = WORDS[i]
            self.create_card(word, None, False)
    
    def create_card(self, word : str, team : Team, is_revealed : bool):
        new_card = Card(word, team, is_revealed)
        self.cards.append(new_card)
    
    def reveal_card(self, card_to_reveal):
        for card in self.cards:
            if card == card_to_reveal:
                card.reveal()
    
    def print_cards(self):
        for card in self.cards:
            card.print_card()
    
    def get_card(self, index):
        return self.cards[index]