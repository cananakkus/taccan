import random

from card import Card
from board import Board
from team import Team
from player import Player


class Game:
    
    def __init__(self):
        self.teams = []
        self.players = []
        self.board = Board()
    
    def run(self):
        pass
    
    def setup(self):
        # Creating a test environment
        self.setup_teams()
        self.setup_players()
    
    def setup_players(self):
        test_player_names = ["Cansoz", "Autar", "Hako", "Archi"]
        for i in range(len(test_player_names)):
            name = test_player_names[i]
            team = self.teams[1] if i <= 1 else self.teams[2]
            self.create_player(id, name, team)
    
    def setup_teams(self):
        self.spectator_team = self.create_team(0, "white", [], [], [])
        self.blue_team = self.create_team(1, "blue", [], [], [])
        self.red_team = self.create_team(2, "red", [], [], [])
        self.teams.append(self.spectator_team)
        self.teams.append(self.blue_team)
        self.teams.append(self.red_team)
    
    def create_team(self, id : int, colour : str, card_list, player_list, spymaster):
        team = Team(id, colour, card_list, player_list, spymaster, self.board)
        self.teams.append(team)
        return team

    def create_player(self, id : int, name : str, team : Team, role="spy"):
        player = Player(id, name, team, role)
        team.add_player(player)
        return player
        